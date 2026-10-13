import type { ReactElement } from "react";
import { toast } from "sonner";
import { useGetFeature } from "@/api/generated";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { FeatureRenameForm } from "@/components/FeatureRenamePopover";
import { useSidebarAttention } from "@/components/SidebarAttentionProvider";
import { useCrossProjectNavigate } from "@/hooks/useCrossProjectNavigate";
import { useFeatureTitle } from "@/hooks/useFeatureTitle";
import { useShortcut } from "@/hooks/useShortcut";
import { apiErrorMessage } from "@/lib/api-errors";
import { getActiveFocusZone } from "@/lib/focus-zones";
import { isStrongAttention, type AttentionState } from "@/lib/sidebar-attention";
import { dispatchSidebarRowAction, type SidebarRowAction } from "@/lib/sidebar-row-actions";
import { useSidebarRenameStore } from "@/stores/sidebar-rename-store";
import { useUnreadStore } from "@/stores/unread-store";

const ROW_SHORTCUT_OPTIONS = { enableOnFormTags: false, enableOnContentEditable: false } as const;

/** The conversation row holding keyboard focus in the sidebar, if any. */
function focusedFeatureRow(): HTMLElement | null {
  if (getActiveFocusZone() !== "left-sidebar") return null;
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement)) return null;
  return focused.matches('[data-nav-type="feature"]') ? focused : null;
}

function focusedFeatureId(row: HTMLElement): number | null {
  const id = Number(row.getAttribute("data-nav-id"));
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Row shortcuts (I8): act on the focused conversation without its menu. */
export function useSidebarRowShortcuts(): void {
  const rowAction = (action: SidebarRowAction) => (event: KeyboardEvent) => {
    const row = focusedFeatureRow();
    if (!row) return;
    event.preventDefault();
    if (!dispatchSidebarRowAction(row, action)) {
      toast.message("This conversation can't do that from here");
    }
  };
  useShortcut("sidebar-row-pin", rowAction("pin"), ROW_SHORTCUT_OPTIONS);
  useShortcut("sidebar-row-archive", rowAction("archive"), ROW_SHORTCUT_OPTIONS);
  useShortcut("sidebar-row-label", rowAction("label"), ROW_SHORTCUT_OPTIONS);
  useShortcut(
    "sidebar-row-rename",
    (event) => {
      const row = focusedFeatureRow();
      const featureId = row && focusedFeatureId(row);
      if (featureId == null) return;
      event.preventDefault();
      useSidebarRenameStore.getState().open(featureId);
    },
    ROW_SHORTCUT_OPTIONS,
  );
  useShortcut(
    "sidebar-row-toggle-unread",
    (event) => {
      const row = focusedFeatureRow();
      const featureId = row && focusedFeatureId(row);
      if (featureId == null) return;
      event.preventDefault();
      useUnreadStore.getState().toggleMarked(featureId);
    },
    ROW_SHORTCUT_OPTIONS,
  );
}

/**
 * Next-in-queue shortcuts (H5): ⌘J goes to the next conversation waiting on
 * you (pending requests oldest first, then failures), ⌥⌘J to the next unread
 * one, each cycling on from the open conversation. Renders nothing.
 */
export function SidebarAttentionShortcuts({
  activeFeatureId,
  onSelectFeature,
}: {
  activeFeatureId: number | null;
  onSelectFeature: (featureId: number) => void;
}): null {
  const { items } = useSidebarAttention();
  const open = useCrossProjectNavigate(activeFeatureId, onSelectFeature);
  const jump =
    (matches: (state: AttentionState) => boolean, emptyMessage: string) =>
    (event: KeyboardEvent) => {
      event.preventDefault();
      const queue = items.filter((item) => matches(item.state));
      if (queue.length === 0) {
        toast.message(emptyMessage);
        return;
      }
      const at = queue.findIndex((item) => item.feature.id === activeFeatureId);
      const next = queue[(at + 1) % queue.length];
      if (next) open(next.feature);
    };
  useShortcut("attention-next-needs-you", jump(isStrongAttention, "Nothing is waiting on you"));
  useShortcut(
    "attention-next-unread",
    jump((state) => state === "unread", "No unread conversations"),
  );
  return null;
}

/** The sidebar's one rename dialog, opened from a row's menu or with F2. */
export function SidebarRenameDialog(): ReactElement {
  const featureId = useSidebarRenameStore((state) => state.featureId);
  const close = useSidebarRenameStore((state) => state.close);
  return (
    <Dialog open={featureId != null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-sm">
        <DialogTitle className="sr-only">Rename conversation</DialogTitle>
        <DialogDescription className="sr-only">
          Give this conversation a new title.
        </DialogDescription>
        {featureId != null && <RenameBody featureId={featureId} onClose={close} />}
      </DialogContent>
    </Dialog>
  );
}

function RenameBody({
  featureId,
  onClose,
}: {
  featureId: number;
  onClose: () => void;
}): ReactElement {
  const { data: feature, isLoading, error } = useGetFeature(featureId);
  const { title: liveTitle } = useFeatureTitle(featureId);
  if (isLoading) return <Skeleton aria-label="Loading conversation" className="h-24" />;
  if (error || !feature) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {apiErrorMessage(error, "Could not load this conversation")}
      </p>
    );
  }
  return (
    <FeatureRenameForm
      featureId={featureId}
      currentTitle={liveTitle ?? feature.title}
      onClose={onClose}
      open
    />
  );
}
