use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[allow(dead_code)]
#[derive(Serialize, ToSchema)]
pub struct NeovimStartResponse {
    pub version: String,
}

#[allow(dead_code)]
#[derive(Deserialize, ToSchema)]
pub struct PushBufferRequest {
    pub file_path: String,
    pub content: String,
}

#[allow(dead_code)]
#[derive(Deserialize, ToSchema)]
pub struct PullBufferRequest {
    pub file_path: String,
}

#[allow(dead_code)]
#[derive(Serialize, Deserialize, ToSchema)]
pub struct PullBufferResponse {
    pub content: String,
}

#[allow(dead_code)]
#[derive(Serialize, Deserialize, ToSchema)]
pub struct NeovimDetectResponse {
    pub available: bool,
}
