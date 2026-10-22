use agent_client_protocol::schema::v1::Meta;
use serde_json::{Map, Value};

use crate::domain::agents::adapter::{RuntimePurpose, RuntimeSpawnConfig};

/// ACP extension metadata for Cadencr-specific session launch purposes.
const CADENCR_META_KEY: &str = "com.cadencr";

pub(super) fn session_meta(config: &RuntimeSpawnConfig) -> Option<Meta> {
    let RuntimePurpose::AutoName = config.purpose?;
    let mut task = Map::new();
    task.insert(
        "purpose".to_string(),
        Value::String("auto_name".to_string()),
    );
    if let Some(system_prompt) = config.system_prompt.as_deref() {
        task.insert(
            "systemPrompt".to_string(),
            Value::String(system_prompt.to_string()),
        );
    }

    let mut meta = Map::new();
    meta.insert(CADENCR_META_KEY.to_string(), Value::Object(task));
    Some(meta)
}
