use crate::domain::sessions::user_messages::canonical_user_message_uuid;
use crate::domain::ws_session::protocol::PromptSendPayload;

pub(super) fn normalize_message_uuid(payload: &mut PromptSendPayload) -> Result<(), String> {
    let message_uuid = canonical_user_message_uuid(payload.message_uuid.as_deref())
        .map_err(|_| "message_uuid must be a valid UUID".to_string())?
        .to_string();
    payload.message_uuid = Some(message_uuid);
    Ok(())
}
