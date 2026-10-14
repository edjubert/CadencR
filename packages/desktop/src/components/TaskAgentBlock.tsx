import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { ChevronRightIcon, Loader2Icon, WrenchIcon } from "lucide-react";
import { Virtuoso, type ItemContent, type VirtuosoHandle } from "react-virtuoso";
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
/** Small timelines stay inline so expanding them does not create empty space. */
export const MAX_INLINE_SUBAGENT_ACTIONS = 24;
const INITIAL_VIRTUALIZED_SUBAGENT_ACTIONS = 12;
const SCROLL_TO_END = Number.MAX_SAFE_INTEGER;

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
export const TaskAgentBlock = memo(function TaskAgentBlock({
  block,
  basePath,
  depth = 0,
}: TaskAgentBlockProps): ReactElement {
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
  const toggleExpanded = useCallback(() => setExpanded((previous) => !previous), []);
  const expand = useCallback(() => setExpanded(true), []);
  const hasActions = actions.length > 0;
  const description = useMemo(
    () => stringArg(parseToolArgsObject(block.toolArgs), "description") ?? "Subtask",
    [block.toolArgs],
  );
  const nestOffset = Math.min(depth, MAX_DEPTH) * CHILD_INDENT_PX;
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
          onToggleExpand={toggleExpanded}
        />
      </div>

      {hasActions && (
        <SubagentTimeline
          actions={actions}
          basePath={basePath}
          depth={depth}
          description={description}
          expanded={expanded}
          isRunning={isRunning}
          onExpand={expand}
        />
      )}
    </div>
  );
});

interface SubagentTimelineProps {
  actions: AgentBlockData[];
  basePath?: string;
  depth: number;
  description: string;
  expanded: boolean;
  isRunning: boolean;
  onExpand: () => void;
}

const SubagentTimeline = memo(function SubagentTimeline(props: SubagentTimelineProps) {
  if (props.expanded && props.actions.length > MAX_INLINE_SUBAGENT_ACTIONS) {
    return <VirtualizedSubagentTimeline {...props} />;
  }
  return <InlineSubagentTimeline {...props} />;
});

function InlineSubagentTimeline({
  actions,
  basePath,
  depth,
  expanded,
  isRunning,
  onExpand,
}: SubagentTimelineProps): ReactElement {
  const { visible, hiddenCount } = windowSubagentActions(actions, expanded);
  const lastVisibleId = visible.at(-1)?.id;
  const { scrollRef, contentRef } = useStickToBottom(isRunning && expanded);
  return (
    <div
      ref={scrollRef}
      className={cn("min-w-0", expanded && "max-h-[28vh] overflow-y-auto")}
      style={{ paddingLeft: CHILD_INDENT_PX }}
    >
      <div ref={contentRef} className="flex flex-col gap-0 pt-1">
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={onExpand}
            className="py-0.5 text-left text-[11px] text-muted-foreground/80 transition-colors hover:text-foreground"
          >
            {hiddenCount} earlier action{hiddenCount === 1 ? "" : "s"}
          </button>
        )}
        {visible.map((child) => (
          <SubagentTimelineRow
            key={child.id}
            block={child}
            basePath={basePath}
            depth={depth}
            expanded={expanded}
            isStreaming={isRunning && child.id === lastVisibleId}
          />
        ))}
      </div>
    </div>
  );
}

interface VirtualizedSubagentContext {
  basePath?: string;
  depth: number;
  isRunning: boolean;
  lastIndex: number;
}

const virtualizedSubagentItemKey = (_index: number, child: AgentBlockData): string => child.id;

const renderVirtualizedSubagentAction: ItemContent<AgentBlockData, VirtualizedSubagentContext> = (
  index,
  child,
  context,
) => (
  <SubagentTimelineRow
    block={child}
    basePath={context.basePath}
    depth={context.depth}
    expanded
    isStreaming={context.isRunning && index === context.lastIndex}
  />
);

function VirtualizedSubagentTimeline({
  actions,
  basePath,
  depth,
  description,
  isRunning,
}: SubagentTimelineProps): ReactElement {
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const followsTailRef = useRef(isRunning);
  const pendingEdgeRef = useRef<"start" | "end" | null>(null);
  const onAtBottomStateChange = useCallback((atBottom: boolean): void => {
    if (pendingEdgeRef.current === "start") {
      if (atBottom) return;
      pendingEdgeRef.current = null;
    } else if (pendingEdgeRef.current === "end") {
      if (!atBottom) return;
      pendingEdgeRef.current = null;
    }
    followsTailRef.current = atBottom;
  }, []);
  const onTotalListHeightChanged = useCallback((): void => {
    if (!followsTailRef.current) return;
    // Unlike item-index scrolling, a direct offset does not retry after later
    // measurements and override a wheel gesture that has since detached follow.
    virtuosoRef.current?.scrollTo({ top: SCROLL_TO_END, behavior: "auto" });
  }, []);
  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>): void => {
    if (
      event.target !== event.currentTarget ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      (event.key !== "Home" && event.key !== "End")
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const atStart = event.key === "Home";
    if (atStart) {
      if (followsTailRef.current) pendingEdgeRef.current = "start";
      followsTailRef.current = false;
    } else {
      pendingEdgeRef.current = "end";
      followsTailRef.current = true;
    }
    virtuosoRef.current?.scrollTo({ top: atStart ? 0 : SCROLL_TO_END, behavior: "auto" });
  }, []);
  const onWheel = useCallback((event: ReactWheelEvent<HTMLElement>): void => {
    if (event.deltaY >= 0 || !followsTailRef.current) return;
    pendingEdgeRef.current = "start";
    followsTailRef.current = false;
  }, []);
  const context = useMemo<VirtualizedSubagentContext>(
    () => ({ basePath, depth, isRunning, lastIndex: actions.length - 1 }),
    [actions.length, basePath, depth, isRunning],
  );

  return (
    <Virtuoso
      ref={virtuosoRef}
      data={actions}
      context={context}
      computeItemKey={virtualizedSubagentItemKey}
      itemContent={renderVirtualizedSubagentAction}
      initialItemCount={INITIAL_VIRTUALIZED_SUBAGENT_ACTIONS}
      initialTopMostItemIndex={isRunning ? { index: actions.length - 1, align: "end" } : 0}
      defaultItemHeight={24}
      increaseViewportBy={48}
      atBottomStateChange={onAtBottomStateChange}
      totalListHeightChanged={onTotalListHeightChanged}
      onKeyDown={onKeyDown}
      onWheel={onWheel}
      className="min-w-0 overflow-x-hidden pt-1"
      style={{ height: "28vh", marginLeft: CHILD_INDENT_PX }}
      role="region"
      aria-label={`${description} actions`}
      tabIndex={0}
      data-testid="subagent-action-timeline"
    />
  );
}

const SubagentTimelineRow = memo(function SubagentTimelineRow({
  block,
  basePath,
  depth,
  expanded,
  isStreaming,
}: {
  block: AgentBlockData;
  basePath?: string;
  depth: number;
  expanded: boolean;
  isStreaming: boolean;
}): ReactElement {
  return (
    <div data-block-id={block.id} data-subagent-action-id={block.id}>
      {isNestedSubagentBlock(block) && depth < MAX_DEPTH ? (
        <TaskAgentBlock block={block} basePath={basePath} depth={depth + 1} />
      ) : (
        <SubagentActionRow
          block={block}
          basePath={basePath}
          expanded={expanded}
          isStreaming={isStreaming}
        />
      )}
    </div>
  );
});

const TaskAgentHeader = memo(function TaskAgentHeader({
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
});
