//! Adapter-owned ACP extension dispatch.
//!
//! The generic event loop knows only that an extension is blocking or
//! fire-and-forget. Provider-specific method names, payload parsing, response
//! schemas, and synthesized runtime events remain behind `AcpProviderHooks`.

use serde_json::{json, Value};
use tokio::sync::mpsc;

use crate::domain::agents::acp::incoming::AcpServerRequest;
use crate::domain::agents::acp::AcpClient;
use crate::domain::agents::adapter::{RuntimeError, RuntimeEvent, RuntimeEventMetadata};

use super::permissions::dispatch_permission_request_for_method;
use super::server_requests::EventLoopConfig;

pub(super) async fn handle_extension_notification(
    method: &str,
    params: &Value,
    tx: &mpsc::Sender<Result<RuntimeEvent, RuntimeError>>,
    config: &EventLoopConfig,
) {
    let metadata = extension_metadata(method, params, config).await;
    let Some(events) = config
        .hooks
        .extension_notification(method, params, metadata)
    else {
        return;
    };
    for event in events {
        if tx.send(Ok(event)).await.is_err() {
            break;
        }
    }
}

pub(super) async fn handle_extension_request(
    client: &AcpClient,
    request: &AcpServerRequest,
    tx: &mpsc::Sender<Result<RuntimeEvent, RuntimeError>>,
    config: &EventLoopConfig,
) -> bool {
    let id = request.id().clone();
    let request_id = id
        .as_str()
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| id.to_string());
    let metadata = extension_metadata(request.method(), request.params(), config).await;
    let extension = config.hooks.extension_request(
        &request_id,
        request.method(),
        request.params(),
        metadata.clone(),
    );
    let Some(extension) = extension else {
        let Some(events) =
            config
                .hooks
                .extension_notification(request.method(), request.params(), metadata)
        else {
            return false;
        };
        for event in events {
            if tx.send(Ok(event)).await.is_err() {
                reject_extension(client, id, request.method(), "runtime channel closed").await;
                return true;
            }
        }
        if let Err(error) = client.respond_server_request(id, json!({})).await {
            tracing::error!(%error, method = request.method(), "failed to acknowledge ACP extension request");
        }
        return true;
    };

    for event in extension.events {
        if tx.send(Ok(event)).await.is_err() {
            reject_extension(client, id, request.method(), "runtime channel closed").await;
            return true;
        }
    }
    let session_id = config.session_id.read().await.clone();
    if let Err(error) = dispatch_permission_request_for_method(
        &config.pending_permissions,
        session_id,
        &request_id,
        id.clone(),
        request.method(),
        extension.permission,
        request.params(),
        tx,
    )
    .await
    {
        tracing::error!(%error, method = request.method(), "failed to surface ACP extension request");
        reject_extension(client, id, request.method(), &error.to_string()).await;
    }
    true
}

async fn extension_metadata(
    method: &str,
    params: &Value,
    config: &EventLoopConfig,
) -> RuntimeEventMetadata {
    RuntimeEventMetadata {
        session_id: config.session_id.read().await.clone(),
        usage: None,
        context_window: None,
        cost_usd: None,
        raw: json!({
            "type": "acp_extension",
            "method": method,
            "params": params,
        }),
    }
}

async fn reject_extension(client: &AcpClient, id: Value, method: &str, message: &str) {
    if let Err(error) = client.reject_server_request(id, -32800, message).await {
        tracing::error!(%error, method, "failed to reject ACP extension request");
    }
}
