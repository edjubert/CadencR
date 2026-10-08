use std::collections::HashMap;
use std::path::{Path, PathBuf};

use codex_app_server_sdk_rs::{AppServerSpawnOptions, CodexAppServerClient, CodexModel};
use serde_json::Value;
use sha2::{Digest, Sha256};

use super::timeouts::{with_probe_timeout, PROBE_TIMEOUT};

pub(super) use super::native_config::{
    catalog_with_effective_config, enrich_resume_config, native_effective_config,
};

use super::{profiles, unavailable_catalog, DEFAULT_MODE_REQUEST_USER_INPUT_FEATURE, PROVIDER_ID};
use crate::domain::agents::adapter::{ResolvedRuntimeProfile, RuntimeError};
use crate::domain::agents::adapter::{RuntimeConfigOverrides, RuntimeEffectiveConfig};
use crate::domain::agents::runtime::ProviderCatalogEntry;
use crate::domain::agents::runtime::{ProviderProfileEntry, ProviderProfilesResponse};

pub(super) async fn probe_models_with_profile(
    profile: Option<&ResolvedRuntimeProfile>,
    cwd: Option<&Path>,
) -> Result<Vec<CodexModel>, RuntimeError> {
    let client = CodexAppServerClient::spawn_with_options(app_server_spawn_options(
        profile.map(|profile| profile.env.clone()),
        profile
            .map(|profile| profile.env_unset.clone())
            .unwrap_or_default(),
        cwd.map(Path::to_path_buf),
    ))
    .await?;
    let result = async {
        client.initialize_with_timeout(PROBE_TIMEOUT).await?;
        with_probe_timeout("Codex model/list", client.model_list()).await
    }
    .await;
    client.shutdown().await;
    result
}

pub(super) async fn probe_models_and_config(
    profile: Option<&ResolvedRuntimeProfile>,
    cwd: &Path,
) -> Result<(Vec<CodexModel>, Value), RuntimeError> {
    let client = CodexAppServerClient::spawn_with_options(app_server_spawn_options(
        profile.map(|profile| profile.env.clone()),
        profile
            .map(|profile| profile.env_unset.clone())
            .unwrap_or_default(),
        Some(cwd.to_path_buf()),
    ))
    .await?;
    let result = async {
        client.initialize_with_timeout(PROBE_TIMEOUT).await?;
        let config = with_probe_timeout("Codex config/read", client.config_read(cwd))
            .await
            .map_err(|_| RuntimeError::new("Codex rejected the effective configuration"))?;
        let models = with_probe_timeout("Codex model/list", client.model_list()).await?;
        Ok::<_, RuntimeError>((models, config))
    }
    .await;
    client.shutdown().await;
    result
}

pub(super) async fn resolved_effective_config(
    selection: Option<&str>,
    cwd: &Path,
    overrides: &RuntimeConfigOverrides,
) -> Result<RuntimeEffectiveConfig, RuntimeError> {
    let profile = resolve_profile_for_selection(selection)?;
    let (models, mut config) = probe_models_and_config(Some(&profile), cwd).await?;
    enrich_resume_config(&mut config, &models, overrides.model.as_deref());
    let native = native_effective_config(&config);
    Ok(RuntimeEffectiveConfig {
        model: overrides.model.clone().or(native.model),
        thinking_effort: overrides.thinking_effort.clone().or(native.thinking_effort),
        fast_mode: overrides
            .fast_mode
            .unwrap_or(native.fast_mode.unwrap_or(false)),
    })
}

pub(super) async fn effective_config_revision(
    env: HashMap<String, String>,
    env_unset: Vec<String>,
    cwd: &Path,
    stored_revision: &str,
) -> Result<String, RuntimeError> {
    let client = CodexAppServerClient::spawn_with_options(app_server_spawn_options(
        Some(env),
        env_unset,
        Some(cwd.to_path_buf()),
    ))
    .await?;
    let result = async {
        client.initialize_with_timeout(PROBE_TIMEOUT).await?;
        with_probe_timeout("Codex config/read", client.config_read(cwd))
            .await
            .map_err(|_| RuntimeError::new("Codex rejected the effective configuration"))
    }
    .await;
    client.shutdown().await;
    fingerprint_effective_config(stored_revision, &result?)
}

fn fingerprint_effective_config(
    stored_revision: &str,
    config: &Value,
) -> Result<String, RuntimeError> {
    let mut digest = Sha256::new();
    digest.update(stored_revision.as_bytes());
    digest.update(serde_json::to_vec(config).map_err(|_| {
        RuntimeError::new("Codex effective configuration could not be fingerprinted")
    })?);
    Ok(digest
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

pub(super) async fn probe_models() -> Result<Vec<CodexModel>, RuntimeError> {
    probe_models_with_profile(None, None).await
}

pub(super) fn app_server_spawn_options(
    env: Option<HashMap<String, String>>,
    env_unset: Vec<String>,
    cwd: Option<PathBuf>,
) -> AppServerSpawnOptions {
    AppServerSpawnOptions::builder()
        .maybe_env(env)
        .env_unset(env_unset)
        .maybe_cwd(cwd)
        .enable_features(vec![DEFAULT_MODE_REQUEST_USER_INPUT_FEATURE.to_string()])
        .build()
}

pub(super) fn profile_catalog() -> ProviderProfilesResponse {
    let active = profiles::active_id().unwrap_or_else(|| "default".to_string());
    let mut entries = vec![ProviderProfileEntry {
        id: "default".to_string(),
        label: "Default Codex home".to_string(),
        description: Some("Uses the user's shared Codex home and config".to_string()),
        is_default: true,
    }];
    entries.extend(
        profiles::list()
            .into_iter()
            .map(|profile| ProviderProfileEntry {
                id: profile.id,
                label: profile.name,
                description: None,
                is_default: false,
            }),
    );
    ProviderProfilesResponse {
        provider: PROVIDER_ID.to_string(),
        active_profile: active,
        default_profile: "default".to_string(),
        profiles: entries,
    }
}

pub(super) async fn resolve_profile(
    selection: Option<&str>,
    cwd: &Path,
) -> Result<ResolvedRuntimeProfile, RuntimeError> {
    let mut profile = resolve_profile_for_selection(selection)?;
    profile.revision = effective_config_revision(
        profile.env.clone(),
        profile.env_unset.clone(),
        cwd,
        &profile.revision,
    )
    .await?;
    Ok(profile)
}

/// Selection/catalog preparation is local. Runtime resolution replaces this
/// storage revision with a fresh fingerprint of Codex's effective config.
pub(super) fn resolve_profile_for_selection(
    selection: Option<&str>,
) -> Result<ResolvedRuntimeProfile, RuntimeError> {
    let resolved = if selection == Some("default") {
        None
    } else {
        profiles::resolve(selection).map_err(|error| RuntimeError::new(error.to_string()))?
    };
    let Some(resolved) = resolved else {
        return Ok(ResolvedRuntimeProfile {
            identity: "default".to_string(),
            revision: "default".to_string(),
            env: HashMap::new(),
            env_unset: Vec::new(),
            state_identity: Some(
                profiles::default_home()
                    .map(|home| home.to_string_lossy().into_owned())
                    .unwrap_or_else(|| "unresolved-codex-home".to_string()),
            ),
        });
    };
    let mut env = resolved.profile.env;
    if resolved.profile.config_path.is_some() {
        let home = resolved
            .effective_home
            .as_deref()
            .expect("configured profile home");
        env.insert(
            "CODEX_HOME".to_string(),
            home.to_string_lossy().into_owned(),
        );
    }
    Ok(ResolvedRuntimeProfile {
        identity: resolved.profile.id,
        revision: resolved.revision,
        env,
        env_unset: resolved.profile.env_unset,
        state_identity: Some(
            resolved
                .effective_home
                .map(|home| home.to_string_lossy().into_owned())
                .unwrap_or_else(|| "unresolved-codex-home".to_string()),
        ),
    })
}

pub(super) async fn catalog_for_profile(profile: Option<&str>, cwd: &Path) -> ProviderCatalogEntry {
    let resolved = match resolve_profile_for_selection(profile) {
        Ok(profile) => profile,
        Err(error) => return unavailable_catalog(error.to_string()),
    };
    match probe_models_and_config(Some(&resolved), cwd).await {
        Ok((models, config)) if !models.is_empty() => {
            catalog_with_effective_config(models, &config)
        }
        Ok(_) => unavailable_catalog("codex app-server returned no models"),
        Err(error) => unavailable_catalog(format!("codex app-server unavailable: {error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::{fingerprint_effective_config, resolve_profile_for_selection};
    use serde_json::json;

    #[test]
    fn native_default_selection_does_not_need_a_running_cli() {
        let profile = resolve_profile_for_selection(Some("default")).unwrap();
        assert_eq!(profile.identity, "default");
        assert_eq!(profile.revision, "default");
        assert!(profile.env.is_empty());
        assert!(profile.env_unset.is_empty());
        assert!(profile.state_identity.is_some());
    }

    #[test]
    fn effective_revision_tracks_config_layers_and_profile_changes() {
        let config = json!({"config": {"model": "native", "model_reasoning_effort": "low"}});
        let before = fingerprint_effective_config("stored", &config).unwrap();
        assert_eq!(
            before,
            fingerprint_effective_config("stored", &config).unwrap()
        );
        assert_ne!(
            before,
            fingerprint_effective_config("changed-env", &config).unwrap()
        );
        let layered = json!({"config": {"model": "project", "model_reasoning_effort": "high"}});
        assert_ne!(
            before,
            fingerprint_effective_config("stored", &layered).unwrap()
        );
    }
}
