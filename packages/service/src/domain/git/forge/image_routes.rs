//! `GET /api/git/forge/image` — fetch an image a pull request points at.
//!
//! The renderer runs under `img-src 'self' data: blob:`, so an `<img>` aimed at
//! `avatars.githubusercontent.com` is blocked before a request ever leaves the
//! process; and an attachment on a private repository needs the forge token,
//! which an `<img>` cannot carry either. Both are answered the way the editor
//! already answers local images: the service fetches the bytes, the frontend
//! renders them from a `blob:` URL.
//!
//! This is deliberately not an open proxy. Only HTTPS is fetched, private and
//! loopback addresses are refused, the response has to actually be an image,
//! and the forge credentials travel only to hosts the forge owns — a badge or
//! third-party CDN referenced from a PR body is fetched anonymously.
//!
//! Excluded from the OpenAPI `paths(...)` set for the same reason
//! `/api/editor/read-image` is: orval would emit an `unknown`-typed hook for a
//! binary body, so the frontend calls it through the API client directly.

mod target;

use std::net::IpAddr;
use std::time::Duration;

use axum::extract::{Query, State};
use axum::response::Response;
use futures::StreamExt;
use reqwest::header::{ACCEPT, CONTENT_TYPE, LOCATION};
use reqwest::{RequestBuilder, StatusCode, Url};
use serde::Deserialize;
use tokio::sync::Semaphore;

use self::target::{ensure_fetchable, ensure_public_ip, is_forge_owned_origin, resolve_image_url};
use super::auth::forge_to_app_error;
use super::provider::ForgeError;
use super::repository::{feature_forge_context, FeatureForge};
use crate::app_state::AppState;
use crate::domain::git::host::GitHost;
use crate::error::AppError;
use crate::shared::image_file::image_response;

/// Avatars are tiny and attachments are screenshots; anything past this is a
/// video or a mistake, and buffering it would cost the user's memory twice.
const MAX_FORGE_CONTENT_IMAGE_BYTES: usize = 8 * 1024 * 1024;
const MAX_FORGE_AVATAR_BYTES: usize = 512 * 1024;
const MAX_CONCURRENT_FORGE_IMAGES: usize = 4;
static FORGE_IMAGE_DOWNLOADS: Semaphore = Semaphore::const_new(MAX_CONCURRENT_FORGE_IMAGES);
/// GitHub answers `github.com/user-attachments/assets/<id>` with a redirect to
/// a signed asset host, which can itself redirect once more.
const MAX_IMAGE_REDIRECTS: usize = 4;

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ForgeImageKind {
    Avatar,
    #[default]
    Content,
}

#[derive(Debug, Deserialize)]
pub struct ForgeImageParams {
    pub feature_id: i64,
    /// The `src` exactly as the pull request body wrote it — absolute,
    /// protocol-relative, or relative to the repository.
    pub url: String,
    #[serde(default)]
    pub kind: ForgeImageKind,
}

pub async fn get_forge_image_handler(
    State(state): State<AppState>,
    Query(params): Query<ForgeImageParams>,
) -> Result<Response, AppError> {
    let forge = feature_forge_context(&state, params.feature_id).await?;
    // A repository-relative `src` is served from the head commit, which the
    // status cache already holds — no extra forge call to find it.
    let head_sha = state
        .forge_status
        .get(params.feature_id)
        .await
        .and_then(|status| status.pr)
        .map(|pr| pr.head_sha);
    let target = resolve_image_url(
        &forge.context.remote,
        forge.kind,
        head_sha.as_deref(),
        &params.url,
    )?;
    let max_bytes = match params.kind {
        ForgeImageKind::Avatar => MAX_FORGE_AVATAR_BYTES,
        ForgeImageKind::Content => MAX_FORGE_CONTENT_IMAGE_BYTES,
    };
    let (bytes, mime) = fetch_image(&forge, target, max_bytes).await?;
    image_response(bytes, &mime)
}

/// Follow the image to wherever the forge is really keeping it.
///
/// Redirects are followed here rather than by reqwest because the client-wide
/// policy forbids them: the credentials decision has to be re-made at every
/// hop, so that a forge URL redirecting to a CDN drops the token on the way.
async fn fetch_image(
    forge: &FeatureForge,
    start: Url,
    max_bytes: usize,
) -> Result<(Vec<u8>, String), AppError> {
    let _permit = FORGE_IMAGE_DOWNLOADS
        .acquire()
        .await
        .expect("forge image semaphore is never closed");
    let mut url = start;
    for _ in 0..=MAX_IMAGE_REDIRECTS {
        ensure_fetchable(&url)?;
        let client = pinned_image_client(&url).await?;
        let request = authenticate(
            forge,
            client.get(url.as_str()).header(ACCEPT, "image/*"),
            is_forge_owned_origin(&forge.context.remote, forge.kind, &url),
        )?;
        let response = request.send().await.map_err(|error| {
            forge_to_app_error(ForgeError::Http(format!(
                "forge image request failed: {error}"
            )))
        })?;
        match redirect_target(&response, &url)? {
            Some(next) => {
                // Never drain an untrusted redirect body: it can be chunked and
                // arbitrarily large, bypassing the terminal image-size limit.
                drop(response);
                url = next;
            }
            None => return read_image(response, max_bytes).await,
        }
    }
    Err(AppError::BadRequest(
        "The forge kept redirecting this image".into(),
    ))
}

/// Resolve one request hop, reject every private result, and pin the accepted
/// addresses into a fresh client. Reqwest therefore cannot perform a second,
/// unconstrained lookup after validation (the DNS-rebinding TOCTOU).
async fn pinned_image_client(url: &Url) -> Result<reqwest::Client, AppError> {
    let host = url
        .host_str()
        .ok_or_else(|| AppError::BadRequest("Image URL is missing a host".into()))?;
    let mut builder = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .user_agent(concat!("Cadencr/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(20));
    if host.parse::<IpAddr>().is_err() {
        let port = url.port_or_known_default().unwrap_or(443);
        let addresses = tokio::net::lookup_host((host, port))
            .await
            .map_err(|error| {
                AppError::BadRequest(format!("Could not resolve image host {host}: {error}"))
            })?
            .collect::<Vec<_>>();
        if addresses.is_empty() {
            return Err(AppError::BadRequest(format!(
                "Image host {host} did not resolve to an address"
            )));
        }
        for address in &addresses {
            ensure_public_ip(address.ip(), host)?;
        }
        builder = builder.resolve_to_addrs(host, &addresses);
    }
    builder
        .build()
        .map_err(|error| AppError::Internal(format!("Image client setup failed: {error}")))
}

/// Attach the forge credentials, in the header shape that forge expects.
///
/// `send_credentials` is false for every host outside the forge, and the
/// request still goes out — public images load, they just do not get to see a
/// token.
fn authenticate(
    forge: &FeatureForge,
    builder: RequestBuilder,
    send_credentials: bool,
) -> Result<RequestBuilder, AppError> {
    if !send_credentials {
        return Ok(builder);
    }
    let credentials = &forge.context.credentials;
    Ok(match forge.kind {
        GitHost::GitHub => builder.bearer_auth(&credentials.token),
        GitHost::GitLab => builder.header("PRIVATE-TOKEN", &credentials.token),
        GitHost::Bitbucket => {
            let username = credentials
                .username
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    AppError::BadRequest(
                        "Bitbucket API tokens require the Atlassian account email as username"
                            .into(),
                    )
                })?;
            builder.basic_auth(username, Some(&credentials.token))
        }
        GitHost::Other => builder,
    })
}

fn redirect_target(response: &reqwest::Response, current: &Url) -> Result<Option<Url>, AppError> {
    if !response.status().is_redirection() {
        return Ok(None);
    }
    let location = response
        .headers()
        .get(LOCATION)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| {
            AppError::BadRequest("The forge redirected this image without saying where".into())
        })?;
    current
        .join(location)
        .map(Some)
        .map_err(|error| AppError::BadRequest(format!("Unreadable image redirect: {error}")))
}

async fn read_image(
    response: reqwest::Response,
    max_bytes: usize,
) -> Result<(Vec<u8>, String), AppError> {
    let status = response.status();
    if !status.is_success() {
        return Err(image_failure(status));
    }
    let mime = content_type(&response);
    if !mime.starts_with("image/") {
        let described = if mime.is_empty() { "nothing" } else { &mime };
        return Err(AppError::BadRequest(format!(
            "That address answered with {described} rather than an image"
        )));
    }
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes as u64)
    {
        return Err(too_large(max_bytes));
    }
    // Streamed rather than `bytes()`: a response with no `content-length` would
    // otherwise be buffered whole before anyone could object to its size.
    let mut bytes = Vec::new();
    let mut chunks = response.bytes_stream();
    while let Some(chunk) = chunks.next().await {
        let chunk =
            chunk.map_err(|error| AppError::Internal(format!("Image download failed: {error}")))?;
        if bytes.len() + chunk.len() > max_bytes {
            return Err(too_large(max_bytes));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok((bytes, mime))
}

fn content_type(response: &reqwest::Response) -> String {
    response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
}

fn image_failure(status: StatusCode) -> AppError {
    match status {
        StatusCode::NOT_FOUND | StatusCode::GONE => {
            AppError::NotFound("This image is no longer on the forge".into())
        }
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => AppError::BadRequest(
            "The forge would not release this image — reconnect it in Settings if the token expired"
                .into(),
        ),
        _ => AppError::BadRequest(format!("The forge refused this image (HTTP {status})")),
    }
}

fn too_large(max_bytes: usize) -> AppError {
    AppError::BadRequest(format!("Image exceeds the {} KB limit", max_bytes / 1024))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn response(status: u16, headers: &[(&str, &str)]) -> reqwest::Response {
        let mut builder = axum::http::Response::builder().status(status);
        for (name, value) in headers {
            builder = builder.header(*name, *value);
        }
        reqwest::Response::from(builder.body(String::new()).expect("build test response"))
    }

    #[test]
    fn a_content_type_with_parameters_still_reads_as_its_mime() {
        // GitHub answers avatars with `image/png; charset=utf-8`, and a naive
        // equality check on the whole header would reject every one of them.
        assert_eq!(
            content_type(&response(
                200,
                &[("content-type", "image/png; charset=utf-8")]
            )),
            "image/png"
        );
    }

    #[test]
    fn a_relative_redirect_is_resolved_against_the_hop_it_came_from() {
        let current = Url::parse("https://github.com/acme/repo/blob/main/a.png").unwrap();
        let next = redirect_target(
            &response(302, &[("location", "/user-attachments/assets/1")]),
            &current,
        )
        .expect("redirect resolves")
        .expect("redirect present");

        assert_eq!(
            next.as_str(),
            "https://github.com/user-attachments/assets/1"
        );
        assert!(redirect_target(&response(200, &[]), &current)
            .expect("terminal response")
            .is_none());
    }

    #[test]
    fn a_redirect_without_a_location_is_refused_rather_than_looped() {
        assert!(redirect_target(
            &response(302, &[]),
            &Url::parse("https://github.com/a.png").unwrap()
        )
        .is_err());
    }

    #[test]
    fn an_expired_token_is_reported_as_something_the_user_can_fix() {
        let error = image_failure(StatusCode::FORBIDDEN);
        assert!(
            matches!(&error, AppError::BadRequest(message) if message.contains("Settings")),
            "{error:?}"
        );
        assert!(matches!(
            image_failure(StatusCode::NOT_FOUND),
            AppError::NotFound(_)
        ));
    }
}
