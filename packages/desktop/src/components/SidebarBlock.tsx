import type { ReactElement, ReactNode, Ref } from "react";
import { ChevronDown, ChevronRight, type LucideIcon } from "lucide-react";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { useSidebarOption } from "@/stores/sidebar-config-store";
import { cn } from "@/lib/utils";
import type { SidebarFoldableBlock } from "@/stores/sidebar-surface-store";

/** The sidebar's section label type: blocks and the Projects header. */
export const EYEBROW_TEXT_CLASS =
  "text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground/65";

/** A hairline above each sidebar section: the sections read as the top level, above projects. */
export const SECTION_DIVIDER_CLASS = "border-t border-border/60 pt-2";

export const EYEBROW_CLASS = `flex items-center gap-1.5 rounded-md px-2 py-1 ${EYEBROW_TEXT_CLASS}`;

interface SidebarBlockProps {
  /** Names the block for the display options' highlight (`sidebar-rows.css`). */
  block: SidebarFoldableBlock;
  label: string;
  icon: LucideIcon;
  /** Shown per the "Block counters" option; omit for blocks whose size is fixed. */
  count?: number;
  /** How many of `count` need an action: read out, and turns the dot counter amber. */
  strongCount?: number;
  /** Foldable blocks fold from their header; others always show their rows. */
  fold?: { expanded: boolean; toggle: () => void };
  /** The line shown instead of the rows when there are none. */
  empty: string;
  isEmpty: boolean;
  /** Caps the rows so a long block scrolls on its own instead of pushing the projects away. */
  capped?: boolean;
  ref?: Ref<HTMLElement>;
  children: ReactNode;
}

/**
 * A content block above the project list (For me, In progress, Recent,
 * Pinned): the shared eyebrow header with its counter (F8), and an empty line
 * when "Hide empty blocks" (F9) is off. Callers decide when to render at all.
 */
export function SidebarBlock({
  block,
  label,
  icon: Icon,
  count,
  strongCount = 0,
  fold,
  empty,
  isEmpty,
  capped = false,
  ref,
  children,
}: SidebarBlockProps): ReactElement {
  const open = fold?.expanded ?? true;
  const content = (
    <>
      <Icon className="size-3 shrink-0" />
      <span>{label}</span>
      {count !== undefined && <BlockCounter count={count} strongCount={strongCount} />}
      {fold &&
        (open ? (
          <ChevronDown className="ml-auto size-3 shrink-0 transition-transform duration-200 ease-[var(--ease-fluid)]" />
        ) : (
          <ChevronRight className="ml-auto size-3 shrink-0 transition-transform duration-200 ease-[var(--ease-fluid)]" />
        ))}
    </>
  );
  const body = (
    <>
      {isEmpty && (
        <p data-sidebar-block-empty className="px-2 py-1 text-[11px] text-muted-foreground/80">
          {empty}
        </p>
      )}
      {!isEmpty && (
        <div className={cn("flex flex-col gap-0.5", capped && "max-h-[40vh] overflow-y-auto")}>
          {children}
        </div>
      )}
    </>
  );
  return (
    <section
      ref={ref}
      aria-label={label}
      data-sidebar-block={block}
      className={cn("mb-3 flex shrink-0 flex-col gap-0.5 px-1", SECTION_DIVIDER_CLASS)}
    >
      {fold ? (
        <button
          type="button"
          data-nav-item
          aria-expanded={open}
          onClick={fold.toggle}
          className={cn(
            EYEBROW_CLASS,
            "outline-none hover:text-foreground focus-visible:text-foreground",
          )}
        >
          {content}
        </button>
      ) : (
        <div className={EYEBROW_CLASS}>{content}</div>
      )}
      {fold ? <CollapsibleSection open={open}>{body}</CollapsibleSection> : body}
    </section>
  );
}

function BlockCounter({
  count,
  strongCount,
}: {
  count: number;
  strongCount: number;
}): ReactElement | null {
  const mode = useSidebarOption("blockCounts");
  const detail = strongCount > 0 ? `, ${strongCount} need an action` : "";
  if (mode === "none" || count === 0) {
    return detail ? <span className="sr-only">{detail}</span> : null;
  }
  if (mode === "dot") {
    return (
      <span
        role="img"
        data-sidebar-block-counter
        aria-label={`${count}${detail}`}
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          strongCount > 0 ? "bg-amber-400" : "bg-muted-foreground",
        )}
      />
    );
  }
  return (
    <span
      data-sidebar-block-counter
      className="rounded-full bg-foreground/[0.08] px-1.5 text-[10px] leading-4 tabular-nums tracking-normal"
    >
      {count}
      {detail && <span className="sr-only">{detail}</span>}
    </span>
  );
}
