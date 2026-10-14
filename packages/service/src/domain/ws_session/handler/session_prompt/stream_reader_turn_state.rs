use crate::domain::session_status::AgentStatus;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct StreamTurnState {
    phase: TurnPhase,
    compacting: bool,
    surfaced_error_this_turn: bool,
    last_signal_status: Option<AgentStatus>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TurnPhase {
    AwaitingFirstEvent,
    Active,
    BetweenTurnsAfterResult,
}

impl StreamTurnState {
    pub(super) fn new() -> Self {
        Self {
            phase: TurnPhase::AwaitingFirstEvent,
            compacting: false,
            surfaced_error_this_turn: false,
            last_signal_status: None,
        }
    }

    pub(super) fn is_between_turns(&self) -> bool {
        matches!(
            self.phase,
            TurnPhase::AwaitingFirstEvent | TurnPhase::BetweenTurnsAfterResult
        )
    }

    pub(super) fn has_completed_turn(&self) -> bool {
        matches!(self.phase, TurnPhase::BetweenTurnsAfterResult)
    }

    #[cfg(test)]
    fn is_compacting(&self) -> bool {
        self.compacting
    }

    pub(super) fn set_compacting(&mut self, next: bool) -> bool {
        if self.compacting == next {
            return false;
        }
        self.compacting = next;
        true
    }

    pub(super) fn has_error_surfaced_this_turn(&self) -> bool {
        self.surfaced_error_this_turn
    }

    pub(super) fn mark_error_surfaced(&mut self, parent_tool_use_id: Option<&str>) {
        // A descendant failure must not suppress a distinct root failure.
        self.surfaced_error_this_turn |= parent_tool_use_id.is_none();
    }

    pub(super) fn mark_fresh_turn_started(&mut self) {
        self.phase = TurnPhase::Active;
        self.surfaced_error_this_turn = false;
    }

    pub(super) fn mark_result(&mut self) {
        self.phase = TurnPhase::BetweenTurnsAfterResult;
        self.compacting = false;
    }

    #[cfg(test)]
    fn last_signal_status(&self) -> Option<AgentStatus> {
        self.last_signal_status
    }

    pub(super) fn record_signal_status(&mut self, next: AgentStatus) -> bool {
        if self.last_signal_status == Some(next) {
            return false;
        }
        self.last_signal_status = Some(next);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn starts_waiting_for_the_first_runtime_event_without_completed_turn() {
        let state = StreamTurnState::new();

        assert!(state.is_between_turns());
        assert!(!state.has_completed_turn());
        assert!(!state.is_compacting());
        assert_eq!(state.last_signal_status(), None);
    }

    #[test]
    fn explicit_turn_start_enters_active_and_resets_turn_error() {
        let mut state = StreamTurnState::new();

        state.mark_error_surfaced(None);
        state.mark_fresh_turn_started();

        assert!(!state.is_between_turns());
        assert!(!state.has_error_surfaced_this_turn());
    }

    #[test]
    fn result_moves_to_between_turns_and_records_completed_turn() {
        let mut state = StreamTurnState::new();

        state.mark_fresh_turn_started();
        state.mark_result();

        assert!(state.is_between_turns());
        assert!(state.has_completed_turn());
        assert!(!state.is_compacting());
    }

    #[test]
    fn compaction_tracks_only_real_state_changes() {
        let mut state = StreamTurnState::new();

        assert!(state.set_compacting(true));
        assert!(state.is_compacting());
        assert!(!state.set_compacting(true));
        assert!(state.set_compacting(false));
        assert!(!state.is_compacting());
    }

    #[test]
    fn signal_deduplication_is_part_of_turn_state() {
        let mut state = StreamTurnState::new();

        assert!(state.record_signal_status(AgentStatus::Agent));
        assert!(!state.record_signal_status(AgentStatus::Agent));
        assert_eq!(state.last_signal_status(), Some(AgentStatus::Agent));
        assert!(state.record_signal_status(AgentStatus::Idle));
    }
    #[test]
    fn child_errors_do_not_suppress_root_errors_or_clear_root_deduplication() {
        let mut state = StreamTurnState::new();
        state.mark_fresh_turn_started();
        state.mark_error_surfaced(Some("spawn-child"));
        assert!(!state.has_error_surfaced_this_turn());
        state.mark_error_surfaced(None);
        assert!(state.has_error_surfaced_this_turn());
        state.mark_error_surfaced(Some("spawn-other"));
        assert!(state.has_error_surfaced_this_turn());
    }
}
