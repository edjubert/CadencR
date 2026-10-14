impl WsSessionPersistence {
    async fn persist_user_tool_results(
        &self,
        session_id: i64,
        message: &RuntimeUserMessage,
        ptuid: Option<&str>,
    ) -> Vec<(String, i64)> {
        let mut identities = Vec::new();
        for item in &message.content {
            if let RuntimeUserContentBlock::ToolResult {
                tool_use_id,
                is_error,
                content,
            } = item
            {
                let content = match content {
                    serde_json::Value::String(text) => text.clone(),
                    other => serde_json::to_string(other).unwrap_or_default(),
                };
                let message_type = if *is_error {
                    "tool_error"
                } else {
                    "tool_result"
                };

                let inserted = Self::insert_message(
                    &self.write_pool,
                    session_id,
                    "tool",
                    &content,
                    message_type,
                    None,
                    tool_use_id.as_deref(),
                    ptuid,
                    None,
                )
                .await;

                match inserted {
                    Ok(row) => {
                        if let Some(tool_id) = tool_use_id {
                            identities.push((tool_id.clone(), row.last_insert_rowid()));
                        }
                        // The authoritative row must exist before its duplicate
                        // can be removed from the live tool_call.
                        if let Some(tool_use_id) = tool_use_id.as_deref() {
                            Self::drop_duplicated_tool_call_output(
                                &self.write_pool,
                                session_id,
                                tool_use_id,
                                &content,
                            )
                            .await;
                        }
                    }
                    Err(error) => tracing::warn!(
                        session_id,
                        tool_use_id,
                        "failed to persist tool result; keeping tool_call output: {error}"
                    ),
                }
            }
        }
        identities
    }
}

#[cfg(test)]
mod tool_result_identity_tests {
    use super::*;
    use crate::domain::agents::adapter::{RuntimeEventKind, RuntimeEventMetadata};
    use serde_json::json;

    #[tokio::test]
    async fn persisted_batch_ids_load_the_correct_full_results() {
        let pool = session_events_tests::setup_test_db().await;
        let mut persistence = WsSessionPersistence::with_session_id(pool.clone(), 1, Some(1));
        let contents = ["first".repeat(30_000), "second".repeat(30_000)];
        let message = RuntimeUserMessage {
            content: contents
                .iter()
                .enumerate()
                .map(|(index, content)| RuntimeUserContentBlock::ToolResult {
                    tool_use_id: Some(format!("tool-{index}")),
                    is_error: index == 1,
                    content: json!(content),
                })
                .collect(),
        };
        let raw = json!({"type":"user", "message":{"content":[
            {"type":"tool_result", "tool_use_id":"tool-0", "content":contents[0]},
            {"type":"tool_result", "tool_use_id":"tool-1", "content":contents[1]}
        ]}});
        let event = RuntimeEvent::new(
            RuntimeEventMetadata {
                session_id: None,
                usage: None,
                context_window: None,
                raw: raw.clone(),
            },
            RuntimeEventKind::UserMessage {
                message,
                parent_tool_use_id: Some("parent".into()),
            },
        );
        let identities = persistence.persist_runtime_event(&event).await;
        let stamped = raw_event_with_agent_message_id(&raw, identities);
        for (index, expected) in contents.iter().enumerate() {
            let id = stamped["message"]["content"][index]["agent_message_id"]
                .as_i64()
                .unwrap();
            let (content, parent, kind): (String, String, String) = sqlx::query_as(
                "SELECT content, parent_tool_use_id, message_type FROM agent_messages WHERE id = ?",
            )
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(&content, expected);
            assert_eq!(parent, "parent");
            assert_eq!(
                kind,
                if index == 1 {
                    "tool_error"
                } else {
                    "tool_result"
                }
            );
        }
    }
}
