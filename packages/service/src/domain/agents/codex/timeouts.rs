use std::future::Future;
use std::time::Duration;

use super::super::adapter::RuntimeError;

// Match the Codex app-server SDK's default request timeout.
pub(super) const PROBE_TIMEOUT: Duration = Duration::from_secs(30);

pub(super) async fn with_probe_timeout<T>(
    operation: &'static str,
    future: impl Future<Output = Result<T, codex_app_server_sdk_rs::SdkError>>,
) -> Result<T, RuntimeError> {
    tokio::time::timeout(PROBE_TIMEOUT, future)
        .await
        .map_err(|_| RuntimeError::from(codex_app_server_sdk_rs::SdkError::Timeout(operation)))?
        .map_err(RuntimeError::from)
}
