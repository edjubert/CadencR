import { startTransition, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { WebSocketSessionFeatureBlock } from "@/components/WebSocketSessionFeatureBlock";
import { FeatureWorkspaceSkeleton } from "@/components/FeatureWorkspaceSkeleton";
import { ResolvedModelProvider } from "@/contexts/ResolvedModelContext";
import { useSaveLastOpenedFeature } from "@/hooks/useSaveLastOpenedFeature";
import { useMarkFeatureRead } from "@/stores/unread-store";
import {
  getFocusedTab,
  selectFeatureLayout,
  useFeatureLayoutStore,
} from "@/stores/feature-layout-store";
import { validateWsSessionSearch } from "./-ws-session-search";

export const Route = createFileRoute("/ws-session/$sessionId")({
  component: WebSocketSessionPage,
  validateSearch: validateWsSessionSearch,
});

function WebSocketSessionPage() {
  const { sessionId } = Route.useParams();
  const { cwd, featureId, projectId, focusTab } = Route.useSearch();
  // Persist the last-opened feature at the route (not the inner block) so we
  // don't double-PUT — `WebSocketSessionFeatureBlock` used to call this too.
  const layoutState = useFeatureLayoutStore(selectFeatureLayout(featureId));
  const focusedTabId = getFocusedTab(layoutState) ?? "agent";
  useSaveLastOpenedFeature(projectId, featureId, focusedTabId);
  // Opening a conversation reads it: clear any pending unread dot.
  useMarkFeatureRead(featureId);
  // Mounting the whole workspace (agent Virtuoso + Lexical composer + the staged
  // side panels) in the switch's commit is what drives the switch INP up. Paint
  // a cheap skeleton first, then mount the real workspace one paint later — see
  // `useDeferredWorkspaceMount`.
  const workspaceReady = useDeferredWorkspaceMount();
  return (
    <ResolvedModelProvider featureId={featureId}>
      {workspaceReady ? (
        <WebSocketSessionFeatureBlock
          sessionId={sessionId}
          cwd={cwd}
          featureId={featureId}
          projectId={projectId}
          requestedFocusTab={focusTab}
        />
      ) : (
        <FeatureWorkspaceSkeleton />
      )}
    </ResolvedModelProvider>
  );
}

/**
 * Gate the heavy workspace mount to just after the skeleton paints.
 *
 * The skeleton commits and paints in response to the switch — that paint is the
 * switch's INP. This passive effect then runs *after* that paint and promotes
 * to the real workspace, so the heavy mount lands off the interaction's
 * critical commit. `startTransition` marks that second render non-urgent so a
 * follow-up switch (an urgent remount) can interrupt it. The route remounts on
 * every switch (the root keys `<Outlet>` on pathname), so a plain boolean
 * re-defers correctly each time.
 */
function useDeferredWorkspaceMount(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    startTransition(() => setReady(true));
  }, []);
  return ready;
}
