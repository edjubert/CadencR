import type { ReactElement } from "react";
import type { LucideIcon } from "lucide-react";
import type { Feature } from "@/api/generated";
import { Skeleton } from "@/components/ui/skeleton";
import { PinnedConversationRow } from "@/components/PinnedConversationRow";
import { SidebarBlock } from "@/components/SidebarBlock";
import { useCrossProjectNavigate } from "@/hooks/useCrossProjectNavigate";
import { useSidebarOption } from "@/stores/sidebar-config-store";
import { useSidebarFilterQuery } from "@/stores/sidebar-filter-store";
import {
  SidebarSurfaceContext,
  useSidebarBlockFold,
  type SidebarFoldableBlock,
} from "@/stores/sidebar-surface-store";

interface SidebarConversationBlockProps {
  label: string;
  icon: LucideIcon;
  surface: SidebarFoldableBlock;
  features: readonly Feature[];
  /** True while rows may still arrive: a skeleton holds the place of an empty list. */
  loading: boolean;
  /** Shown inline in place of the rows. */
  error?: string;
  empty: string;
  /** Omitted for blocks whose size is fixed (Recent). */
  showCount?: boolean;
  strongCount?: number;
  activeFeatureId: number | null;
  onSelectFeature: (featureId: number) => void;
}

/**
 * A foldable block of cross-project conversation rows (For me, In progress,
 * Recent). Hidden while the sidebar filter is on (the tree shows the matches),
 * and when empty unless empty blocks are kept.
 */
export function SidebarConversationBlock({
  label,
  icon,
  surface,
  features,
  loading,
  error,
  empty,
  showCount = true,
  strongCount,
  activeFeatureId,
  onSelectFeature,
}: SidebarConversationBlockProps): ReactElement | null {
  const filtering = useSidebarFilterQuery() !== "";
  const hideEmpty = useSidebarOption("hideEmptyBlocks");
  const fold = useSidebarBlockFold(surface);
  const handleNavigate = useCrossProjectNavigate(activeFeatureId, onSelectFeature);
  const isEmpty = features.length === 0 && !loading && !error;

  if (filtering || (isEmpty && hideEmpty)) return null;
  return (
    <SidebarBlock
      block={surface}
      label={label}
      icon={icon}
      count={showCount ? features.length : undefined}
      strongCount={strongCount}
      fold={fold}
      empty={empty}
      isEmpty={isEmpty}
      capped
    >
      {error ? (
        <p role="alert" className="px-2 py-1 text-[11px] text-destructive">
          {error}
        </p>
      ) : features.length === 0 ? (
        <Skeleton aria-label={`Loading ${label}`} className="mx-2 my-1 h-5" />
      ) : (
        <SidebarSurfaceContext.Provider value={surface}>
          {features.map((feature) => (
            <PinnedConversationRow
              key={feature.id}
              feature={feature}
              activeFeatureId={activeFeatureId}
              onNavigate={handleNavigate}
            />
          ))}
        </SidebarSurfaceContext.Provider>
      )}
    </SidebarBlock>
  );
}
