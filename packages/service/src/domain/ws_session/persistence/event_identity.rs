use super::PersistedMessageRef;
use std::collections::HashMap;

pub enum PersistedEventRef {
    Message(PersistedMessageRef),
    ToolResults(Vec<(String, i64)>),
}

/// Results are stamped individually: a single event can persist several rows.
pub fn raw_event_with_agent_message_id(
    raw: &serde_json::Value,
    persisted: Option<PersistedEventRef>,
) -> serde_json::Value {
    let mut value = raw.clone();
    match persisted {
        Some(PersistedEventRef::Message(message)) => {
            if let Some(object) = value.as_object_mut() {
                object.insert("agent_message_id".into(), message.id.into());
            }
        }
        Some(PersistedEventRef::ToolResults(results)) => {
            let mut unique_ids = HashMap::new();
            for (tool_id, id) in results {
                unique_ids
                    .entry(tool_id)
                    .and_modify(|id| *id = None)
                    .or_insert(Some(id));
            }
            let Some(items) = value
                .pointer_mut("/message/content")
                .and_then(|v| v.as_array_mut())
            else {
                return value;
            };
            for item in items {
                if item["type"] != "tool_result" {
                    continue;
                }
                let Some(tool_id) = item["tool_use_id"].as_str() else {
                    continue;
                };
                // Never attach a plausible but ambiguous row identity.
                if let Some(Some(id)) = unique_ids.get(tool_id) {
                    item["agent_message_id"] = (*id).into();
                }
            }
        }
        None => {}
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn stamps_results_individually_and_rejects_ambiguous_ids() {
        let raw = json!({"type":"user", "message":{"content":[
            {"type":"tool_result","tool_use_id":"a","content":"first"},
            {"type":"tool_result","tool_use_id":"b","content":"second"},
            {"type":"tool_result","tool_use_id":"ambiguous","content":"third"}
        ]}});
        let stamped = raw_event_with_agent_message_id(
            &raw,
            Some(PersistedEventRef::ToolResults(vec![
                ("b".into(), 22),
                ("a".into(), 11),
                ("ambiguous".into(), 33),
                ("ambiguous".into(), 44),
            ])),
        );
        assert_eq!(stamped["message"]["content"][0]["agent_message_id"], 11);
        assert_eq!(stamped["message"]["content"][1]["agent_message_id"], 22);
        assert!(stamped["message"]["content"][2]["agent_message_id"].is_null());
        assert!(stamped["agent_message_id"].is_null());
    }
}
