import type { ReactElement } from "react";
import { AlertTriangleIcon, ListChecksIcon } from "lucide-react";
import { FeatureMetaBadge } from "@/components/FeatureMetaBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { hasOpenTodos, type RowSummary } from "@/lib/sidebar-row-summary";

/** Whether the meta line has a todo chip: open todos, or why they couldn't load. */
export function hasTodoChip(summary: RowSummary | undefined): summary is RowSummary {
  return summary != null && (summary.error != null || hasOpenTodos(summary.todos));
}

/** The agent's todo progress on the meta line: "3/7", or a warning when it couldn't load. */
export function FeatureTodoProgress({ summary }: { summary: RowSummary }): ReactElement {
  const { todos, error } = summary;
  return (
    <span data-feature-todos className="inline-flex shrink-0">
      {error || !todos ? (
        <FeatureMetaBadge
          icon={<ListChecksIcon className="size-3" />}
          label={`Todo progress unavailable: ${error}`}
          className="text-destructive"
        >
          <AlertTriangleIcon className="size-3" />
        </FeatureMetaBadge>
      ) : (
        <FeatureMetaBadge
          icon={<ListChecksIcon className="size-3" />}
          label={`${todos.done} of ${todos.total} todos done`}
        >
          <span>
            {todos.done}/{todos.total}
          </span>
        </FeatureMetaBadge>
      )}
    </span>
  );
}

/**
 * The start of the agent's last reply, under the title. Holds its line while
 * loading and when there is no reply yet, so rows don't jump as previews land.
 */
export function FeatureRowPreviewLine({
  summary,
}: {
  summary: RowSummary | undefined;
}): ReactElement {
  if (!summary) return <Skeleton data-feature-preview className="my-0.5 h-3 w-32" />;
  if (summary.error) {
    return (
      <span data-feature-preview title={summary.error} className={LINE_CLASS}>
        Preview unavailable
      </span>
    );
  }
  return (
    <span data-feature-preview title={summary.preview ?? undefined} className={LINE_CLASS}>
      {summary.preview ?? " "}
    </span>
  );
}

const LINE_CLASS = "min-w-0 truncate pl-5 text-[11px] leading-4 text-muted-foreground";
