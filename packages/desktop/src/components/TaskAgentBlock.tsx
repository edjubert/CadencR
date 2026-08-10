import { useMemo, useState, type ReactElement } from "react";
import { ChevronRightIcon, Loader2Icon, WrenchIcon } from "lucide-react";
import { type AgentBlockData } from "@/components/AgentBlock";
import { SubagentActionRow } from "@/components/SubagentActionRow";
import {
  isNestedSubagentBlock,
  selectSubagentActions,
  windowSubagentActions,
} from "@/components/subagent-actions";
import { extractTaskOutput } from "@/lib/tool-adapter";
import { parseToolArgsObject, stringArg } from "@/lib/tool-args";
import { useStickToBottom } from "@/hooks/useStickToBottom";
import { cn } from "@/lib/utils";

/** Left inset for child actions under an agent tile, and per nested depth. */
const CHILD_INDENT_PX = 24;
/** Stop nesting TaskAgentBlock past this depth (indent and recursion). */
const MAX_DEPTH = 4;

interface TaskAgentBlockProps {
  block: AgentBlockData;
  basePath?: string;
  /** Nesting depth for left indent (parent stream = 0). */
  depth?: number;
}

/**
 * Task/Agent sub-agent view: only the carrier is a bordered tool tile.
 * Child actions float underneath with left indent. Nested Task/Agent children
 * re-enter this component at depth+1 (capped). Expanding reveals the full
 * timeline (scrollable) and uncapped prose.
 */
export function TaskAgentBlock({ block, basePath, depth = 0 }: TaskAgentBlockProps): ReactElement {
  const children = useMemo(() => {
    const persistedOutput = extractTaskOutput(block.toolArgs);
    if (block.childBlocks?.length || !persistedOutput) return block.childBlocks ?? [];
    return [
      {
        id: `${block.id}-persisted-output`,
        type: "text",
        content: persistedOutput,
      } satisfies AgentBlockData,
    ];
  }, [block.childBlocks, block.id, block.toolArgs]);

  const actions = useMemo(() => selectSubagentActions(children), [children]);
  const isRunning = !block.taskComplete;
  const [expanded, setExpanded] = useState(false);
  const { visible, hiddenCount } = windowSubagentActions(actions, expanded);
  const hasActions = actions.length > 0;
  const description = useMemo(
    () => stringArg(parseToolArgsObject(block.toolArgs), "description") ?? "Subtask",
    [block.toolArgs],
  );
  const nestOffset = Math.min(depth, MAX_DEPTH) * CHILD_INDENT_PX;
  const lastVisibleId = visible[visible.length - 1]?.id;

  const { scrollRef, contentRef } = useStickToBottom(isRunning && expanded);

  return (
    <div
      className="my-1 min-w-0"
      style={nestOffset > 0 ? { marginLeft: nestOffset } : undefined}
      data-subagent-depth={depth}
    >
      <div
        data-tool-family="task"
        className="rounded-md border border-border bg-[var(--block-task-bg)]"
      >
        <TaskAgentHeader
          toolName={block.toolName}
          description={description}
          isRunning={isRunning}
          expanded={expanded}
          canExpand={hasActions}
          onToggleExpand={() => setExpanded((prev) => !prev)}
        />
      </div>

      {hasActions && (
        <div
          ref={scrollRef}
          className={cn("min-w-0", expanded && "max-h-[28vh] overflow-y-auto")}
          style={{ paddingLeft: CHILD_INDENT_PX }}
        >
          <div ref={contentRef} className="flex flex-col gap-0 pt-1">
            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="py-0.5 text-left text-[11px] text-muted-foreground/80 hover:text-foreground transition-colors"
              >
                {hiddenCount} earlier action{hiddenCount === 1 ? "" : "s"}
              </button>
            )}
            {visible.map((child) => {
              if (isNestedSubagentBlock(child) && depth < MAX_DEPTH) {
                return (
                  <TaskAgentBlock
                    key={child.id}
                    block={child}
                    basePath={basePath}
                    depth={depth + 1}
                  />
                );
              }
              return (
                <SubagentActionRow
                  key={child.id}
                  block={child}
                  basePath={basePath}
                  expanded={expanded}
                  isStreaming={isRunning && child.id === lastVisibleId}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function TaskAgentHeader({
  toolName,
  description,
  isRunning,
  expanded,
  canExpand,
  onToggleExpand,
}: {
  toolName?: string;
  description: string;
  isRunning: boolean;
  expanded: boolean;
  canExpand: boolean;
  onToggleExpand: () => void;
}): ReactElement {
  const name = toolName ?? "Task";
  return (
    <button
      type="button"
      disabled={!canExpand}
      onClick={onToggleExpand}
      aria-expanded={expanded}
      aria-label={expanded ? "Collapse sub-agent actions" : "Expand sub-agent actions"}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs disabled:cursor-default"
    >
      <WrenchIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      <span className="shrink-0 font-medium text-foreground">{name}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{description}</span>
      {isRunning && (
        <Loader2Icon
          className="size-3 shrink-0 animate-spin text-muted-foreground"
          aria-label="Running"
        />
      )}
      {canExpand && (
        <ChevronRightIcon
          className={cn(
            "ml-auto size-3 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none",
            expanded && "rotate-90",
          )}
        />
      )}
    </button>
  );
}
