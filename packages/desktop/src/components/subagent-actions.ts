import type { AgentBlockData } from "@/components/AgentBlock";
import { isCountableTool } from "@/components/agentStreamSummary";

/** Collapsed sub-agent view keeps only the newest actions visible. */
export const MAX_COLLAPSED_SUBAGENT_ACTIONS = 5;

/**
 * Blocks that read as a sub-agent "action" in the minimal timeline: tool calls,
 * assistant text, and thinking. Tool results and bookkeeping tools are skipped
 * so each row maps to one model instruction.
 */
export function isSubagentAction(block: AgentBlockData): boolean {
  if (block.type === "text") return block.content.trim().length > 0;
  if (block.type === "thinking") return true;
  return isCountableTool(block);
}

export function selectSubagentActions(blocks: AgentBlockData[]): AgentBlockData[] {
  return blocks.filter(isSubagentAction);
}

export function windowSubagentActions(
  actions: AgentBlockData[],
  expanded: boolean,
): { visible: AgentBlockData[]; hiddenCount: number } {
  if (expanded || actions.length <= MAX_COLLAPSED_SUBAGENT_ACTIONS) {
    return { visible: actions, hiddenCount: 0 };
  }
  return {
    visible: actions.slice(-MAX_COLLAPSED_SUBAGENT_ACTIONS),
    hiddenCount: actions.length - MAX_COLLAPSED_SUBAGENT_ACTIONS,
  };
}

export function isNestedSubagentBlock(block: AgentBlockData): boolean {
  return (
    block.type === "tool_call" &&
    (block.toolName === "Task" || block.toolName === "Agent") &&
    block.childBlocks !== undefined
  );
}

/** Collapse multiline assistant text to a single scannable preview. */
export function truncateSubagentText(content: string, maxLen = 100): string {
  const single = content.replace(/\s+/g, " ").trim();
  if (single.length <= maxLen) return single;
  return `${single.slice(0, maxLen - 1)}…`;
}

/** First non-empty source line — still valid markdown for a one-line preview. */
export function firstSubagentMarkdownLine(content: string): string {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return "";
}
