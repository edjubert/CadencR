//! HTTP routes for Claude Code profiles and custom models.

use std::collections::HashMap;

use axum::extract::{Path, Query, State};
use axum::routing::{get, put};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::app_state::AppState;
use crate::domain::agents::runtime::ModelCatalogEntry;
use crate::error::AppError;

use super::oauth_usage::{
    clear_oauth_cache, live_usage, live_usage_force_refresh, UsageCacheEntry, UsageStatus,
};
use super::{custom_models, profiles};

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ProfileView {
    pub name: String,
    pub env: HashMap<String, String>,
}

impl From<profiles::ClaudeCodeProfile> for ProfileView {
    /// Redacts secret-looking env values. The response path must never expose
    /// token/key/secret/password/auth/credential values; the runtime path
    /// calls `profiles::resolve_active_profile_env` directly for injection.
    fn from(value: profiles::ClaudeCodeProfile) -> Self {
        Self {
            name: value.name,
            env: profiles::redact_env_for_response(&value.env),
        }
    }
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ProfilesResponse {
    pub profiles: Vec<ProfileView>,
    /// Currently active profile name. `"default"` when no profile is applied.
    pub active: String,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct UpsertProfileRequest {
    pub env: HashMap<String, String>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct SetActiveProfileRequest {
    pub name: String,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct CustomModelsResponse {
    pub models: Vec<ModelCatalogEntry>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct UpsertCustomModelRequest {
    pub label: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub supports_effort: Option<bool>,
    #[serde(default)]
    pub supported_effort_levels: Option<Vec<String>>,
    #[serde(default)]
    pub default_effort_level: Option<String>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
#[schema(as = ClaudeCodeSuccessResponse)]
pub struct SuccessResponse {
    pub ok: bool,
}

#[utoipa::path(
    get,
    path = "/api/claude-code/profiles",
    responses((status = 200, body = ProfilesResponse))
)]
pub async fn list_profiles_handler() -> Result<Json<ProfilesResponse>, AppError> {
    let profiles = profiles::list_profiles();
    let active = profiles::get_active_profile_name();
    Ok(Json(ProfilesResponse {
        profiles: profiles.into_iter().map(ProfileView::from).collect(),
        active,
    }))
}

#[utoipa::path(
    put,
    path = "/api/claude-code/profiles/{name}",
    params(("name" = String, Path,)),
    request_body = UpsertProfileRequest,
    responses((status = 200, body = ProfileView))
)]
pub async fn upsert_profile_handler(
    Path(name): Path<String>,
    Json(body): Json<UpsertProfileRequest>,
) -> Result<Json<ProfileView>, AppError> {
    let profile = profiles::upsert_profile(&name, &body.env).await?;
    Ok(Json(ProfileView::from(profile)))
}

#[utoipa::path(
    delete,
    path = "/api/claude-code/profiles/{name}",
    params(("name" = String, Path,)),
    responses((status = 200, body = SuccessResponse))
)]
pub async fn delete_profile_handler(
    Path(name): Path<String>,
) -> Result<Json<SuccessResponse>, AppError> {
    profiles::delete_profile(&name).await?;
    Ok(Json(SuccessResponse { ok: true }))
}

#[utoipa::path(
    put,
    path = "/api/claude-code/profiles/active",
    request_body = SetActiveProfileRequest,
    responses((status = 200, body = SuccessResponse))
)]
pub async fn set_active_profile_handler(
    Json(body): Json<SetActiveProfileRequest>,
) -> Result<Json<SuccessResponse>, AppError> {
    profiles::set_active_profile(&body.name).await?;
    Ok(Json(SuccessResponse { ok: true }))
}

#[utoipa::path(
    get,
    path = "/api/claude-code/custom-models",
    responses((status = 200, body = CustomModelsResponse))
)]
pub async fn list_custom_models_handler(
    State(state): State<AppState>,
) -> Result<Json<CustomModelsResponse>, AppError> {
    let models = custom_models::list_custom_models(&state.read_pool).await?;
    Ok(Json(CustomModelsResponse { models }))
}

#[utoipa::path(
    put,
    path = "/api/claude-code/custom-models/{model_id}",
    params(("model_id" = String, Path,)),
    request_body = UpsertCustomModelRequest,
    responses((status = 200, body = ModelCatalogEntry))
)]
pub async fn upsert_custom_model_handler(
    State(state): State<AppState>,
    Path(model_id): Path<String>,
    Json(body): Json<UpsertCustomModelRequest>,
) -> Result<Json<ModelCatalogEntry>, AppError> {
    let entry = custom_models::upsert_custom_model(
        &state.write_pool,
        &model_id,
        &body.label,
        body.description.as_deref(),
        custom_models::CustomModelEffort {
            supports_effort: body.supports_effort,
            supported_effort_levels: body.supported_effort_levels,
            default_effort_level: body.default_effort_level,
        },
    )
    .await?;
    Ok(Json(entry))
}

#[utoipa::path(
    delete,
    path = "/api/claude-code/custom-models/{model_id}",
    params(("model_id" = String, Path,)),
    responses((status = 200, body = SuccessResponse))
)]
pub async fn delete_custom_model_handler(
    State(state): State<AppState>,
    Path(model_id): Path<String>,
) -> Result<Json<SuccessResponse>, AppError> {
    custom_models::delete_custom_model(&state.write_pool, &model_id).await?;
    Ok(Json(SuccessResponse { ok: true }))
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum OauthUsageResponseStatus {
    Available,
    /// Not authenticated via `claude login` — expected, not an error. The
    /// frontend hides the quota section for this status.
    NotApplicable,
    /// A real failure (network, non-2xx, malformed response). The frontend
    /// shows a visible "unavailable" message for this status.
    Unavailable,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct OauthQuotaWindow {
    pub utilization: f64,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct OauthUsageSnapshotResponse {
    pub five_hour: OauthQuotaWindow,
    pub seven_day: OauthQuotaWindow,
    pub seven_day_sonnet: OauthQuotaWindow,
    pub seven_day_opus: OauthQuotaWindow,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct OauthUsageResponse {
    pub status: OauthUsageResponseStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<OauthUsageSnapshotResponse>,
    /// Seconds since the Unix epoch when this snapshot was fetched — the
    /// frontend computes "fetched Ns ago" from this, not from a live timer.
    pub fetched_at: u64,
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct OauthUsageQuery {
    #[serde(default)]
    pub force: bool,
}

fn oauth_usage_response_from_entry(entry: UsageCacheEntry) -> OauthUsageResponse {
    // `entry.fetched_at` is a monotonic `Instant` — convert to a wall-clock
    // unix timestamp the frontend can diff against `Date.now()`.
    let elapsed_secs = entry.fetched_at.elapsed().as_secs();
    let fetched_at_unix_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|since_epoch| since_epoch.as_secs().saturating_sub(elapsed_secs))
        .unwrap_or(0);
    match entry.status {
        UsageStatus::Available(snapshot) => OauthUsageResponse {
            status: OauthUsageResponseStatus::Available,
            reason: None,
            snapshot: Some(OauthUsageSnapshotResponse {
                five_hour: OauthQuotaWindow {
                    utilization: (snapshot.five_hour.map(|w| w.utilization).unwrap_or(0.0)) / 100.0,
                },
                seven_day: OauthQuotaWindow {
                    utilization: (snapshot.seven_day.map(|w| w.utilization).unwrap_or(0.0)) / 100.0,
                },
                seven_day_sonnet: OauthQuotaWindow {
                    utilization: (snapshot
                        .seven_day_sonnet
                        .map(|w| w.utilization)
                        .unwrap_or(0.0))
                        / 100.0,
                },
                seven_day_opus: OauthQuotaWindow {
                    utilization: (snapshot
                        .seven_day_opus
                        .map(|w| w.utilization)
                        .unwrap_or(0.0))
                        / 100.0,
                },
            }),
            fetched_at: fetched_at_unix_secs,
        },
        UsageStatus::NotApplicable => OauthUsageResponse {
            status: OauthUsageResponseStatus::NotApplicable,
            reason: None,
            snapshot: None,
            fetched_at: fetched_at_unix_secs,
        },
        UsageStatus::Unavailable(reason) => OauthUsageResponse {
            status: OauthUsageResponseStatus::Unavailable,
            reason: Some(reason),
            snapshot: None,
            fetched_at: fetched_at_unix_secs,
        },
    }
}

#[utoipa::path(
    get,
    path = "/api/claude-code/oauth-usage",
    params(OauthUsageQuery),
    responses((status = 200, body = OauthUsageResponse))
)]
pub async fn get_claude_code_oauth_usage_handler(
    Query(query): Query<OauthUsageQuery>,
) -> Json<OauthUsageResponse> {
    let entry = if query.force {
        live_usage_force_refresh().await
    } else {
        live_usage().await
    };
    Json(oauth_usage_response_from_entry(entry))
}

#[utoipa::path(
    delete,
    path = "/api/claude-code/oauth-usage",
    responses((status = 200, body = SuccessResponse))
)]
pub async fn delete_claude_code_oauth_usage_cache_handler() -> Json<SuccessResponse> {
    clear_oauth_cache().await;
    Json(SuccessResponse { ok: true })
}

pub fn claude_code_router() -> Router<AppState> {
    Router::new()
        .route("/api/claude-code/profiles", get(list_profiles_handler))
        .route(
            "/api/claude-code/profiles/active",
            put(set_active_profile_handler),
        )
        .route(
            "/api/claude-code/profiles/{name}",
            put(upsert_profile_handler).delete(delete_profile_handler),
        )
        .route(
            "/api/claude-code/custom-models",
            get(list_custom_models_handler),
        )
        .route(
            "/api/claude-code/custom-models/{model_id}",
            put(upsert_custom_model_handler).delete(delete_custom_model_handler),
        )
        .route(
            "/api/claude-code/oauth-usage",
            get(get_claude_code_oauth_usage_handler)
                .delete(delete_claude_code_oauth_usage_cache_handler),
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oauth_usage_response_serializes_unavailable_without_snapshot() {
        let response = OauthUsageResponse {
            status: OauthUsageResponseStatus::Unavailable,
            reason: Some("unexpected status 500".into()),
            snapshot: None,
            fetched_at: 0,
        };
        let value = serde_json::to_value(&response).unwrap();
        assert_eq!(value["status"], serde_json::json!("unavailable"));
        assert!(value.get("snapshot").is_none());
    }

    #[test]
    fn oauth_usage_response_serializes_not_applicable_without_reason() {
        let response = OauthUsageResponse {
            status: OauthUsageResponseStatus::NotApplicable,
            reason: None,
            snapshot: None,
            fetched_at: 0,
        };
        let value = serde_json::to_value(&response).unwrap();
        assert_eq!(value["status"], serde_json::json!("not_applicable"));
        assert!(value.get("reason").is_none());
        assert!(value.get("snapshot").is_none());
    }

    #[test]
    fn oauth_usage_response_from_entry_maps_not_applicable() {
        let entry = UsageCacheEntry {
            status: UsageStatus::NotApplicable,
            fetched_at: std::time::Instant::now(),
        };
        let response = oauth_usage_response_from_entry(entry);
        assert!(matches!(
            response.status,
            OauthUsageResponseStatus::NotApplicable
        ));
        assert!(response.reason.is_none());
    }
}
