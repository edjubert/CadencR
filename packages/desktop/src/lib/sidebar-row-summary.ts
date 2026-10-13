import type { TodoProgress } from "@/api/generated";
import type { AttentionState } from "@/lib/sidebar-attention";
import type { SidebarConfig } from "@/lib/sidebar-config";

/** What a row previews of its conversation: the agent's last reply and its todo progress. */
export interface RowSummary {
  preview: string | null;
  todos: TodoProgress | null;
  /** Why the summary couldn't load; the preview line and todo chip say so. */
  error: string | null;
}

/** How a row lays out its lines, from the display options and the row's state. */
export interface RowLayout {
  /** Title line only (compact rows), unless the conversation waits on you. */
  compact: boolean;
  /** The details sit beside the title instead of on their own line (uniform rows). */
  foldMeta: boolean;
  /** The agent's last reply under the title. */
  showsPreview: boolean;
  /** The todo progress among the details. */
  showsTodos: boolean;
}

type LayoutOptions = Pick<
  SidebarConfig,
  "compactRows" | "uniformRows" | "titleLines" | "preview" | "todos" | "pendingRequest"
>;

/**
 * Compact rows grow back when their conversation waits, so the request shows.
 * Two-line titles keep the details on their own line: there is no single line
 * to share. A label being edited needs the room of its own line too. A pending
 * request takes the preview's line: it is what the agent says now.
 */
export function rowLayout(
  options: LayoutOptions,
  state: AttentionState,
  editingLabel: boolean,
): RowLayout {
  const compact = options.compactRows && state !== "waiting";
  const showsRequest = state === "waiting" && options.pendingRequest;
  return {
    compact,
    foldMeta: options.uniformRows && options.titleLines !== "two" && !editingLabel,
    showsPreview: !compact && options.preview !== "none" && !showsRequest,
    showsTodos: !compact && options.todos,
  };
}

/** Todos count while some are left; a finished list says nothing more. */
export function hasOpenTodos(todos: TodoProgress | null | undefined): todos is TodoProgress {
  return todos != null && todos.total > 0 && todos.done < todos.total;
}
