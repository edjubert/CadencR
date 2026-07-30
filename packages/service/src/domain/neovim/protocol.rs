use serde::Serialize;
use utoipa::ToSchema;

#[allow(dead_code)]
#[derive(Serialize, ToSchema)]
pub struct NeovimStartResponse {
    pub version: String,
}
