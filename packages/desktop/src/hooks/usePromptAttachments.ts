import { useLayoutEffect, useMemo, useRef } from "react";
import { useImageAttachments, type UseImageAttachmentsResult } from "@/hooks/useImageAttachments";
import {
  attachmentDraftScope,
  takeAttachmentDraft,
  writeAttachmentDraft,
} from "@/lib/prompt-attachment-drafts";
import { promptDropTargetIdOf } from "@/lib/prompt-drop-target";

export interface PromptAttachmentsArgs {
  wsSessionId?: string | null;
  sessionId?: number | null;
  featureId?: number | null;
  providerId?: string;
}

export interface UsePromptAttachmentsResult extends UseImageAttachmentsResult {
  /**
   * Stable id the agent `<section>` stamps via `data-agent-prompt-id`. The
   * preload's drop handler reads it back so the OS drop is routed to the
   * matching `useImageAttachments` consumer.
   */
  promptDropTargetId: string;
}

/**
 * Keep unsent attachments with their feature across mounts and feature
 * switches.
 *
 * `useImageAttachments` holds them in component state, so leaving a
 * conversation used to discard them silently. Claim the scope's draft on the
 * way in and hand the current one back on the way out: because the effect's
 * cleanup runs before the next scope's setup, a feature switch flushes the
 * outgoing feature before loading the incoming one, and no intermediate render
 * can write one feature's attachments under another's key.
 *
 * Persisting only on cleanup is enough — the map is in-memory and dies with the
 * window, so there is nothing to protect against between unmounts.
 */
function useAttachmentDraftSync(
  scope: string,
  attachments: UseImageAttachmentsResult["attachments"],
  restoreAttachments: UseImageAttachmentsResult["restoreAttachments"],
): void {
  const latest = useRef(attachments);
  latest.current = attachments;
  // The scope the current state belongs to. Distinguishes a *switch*, where the
  // outgoing feature's attachments must be cleared even if the incoming one has
  // no draft, from a fresh *mount*, where state is already empty and committing
  // an empty list would re-render the whole prompt bar for nothing — and, under
  // StrictMode's replayed setup, would undo the restore that just happened.
  const ownedScope = useRef<string | null>(null);
  useLayoutEffect(() => {
    const stored = takeAttachmentDraft(scope);
    const switched = ownedScope.current !== null && ownedScope.current !== scope;
    if (stored.length > 0 || switched) restoreAttachments(stored);
    ownedScope.current = scope;
    return () => writeAttachmentDraft(scope, latest.current);
  }, [restoreAttachments, scope]);
}

/**
 * Wires up image attachments for a prompt bar — derives the drop-routing id
 * from the session/feature identity, keeps unsent attachments across feature
 * switches, and forwards the rest of the `useImageAttachments` API. Lives in
 * its own hook so the (already-large) `AgentPromptBar` component doesn't need
 * to know about drop-target wiring.
 */
export function usePromptAttachments(args: PromptAttachmentsArgs): UsePromptAttachmentsResult {
  const promptDropTargetId = useMemo(
    () =>
      promptDropTargetIdOf({
        wsSessionId: args.wsSessionId,
        dbSessionId: args.sessionId,
        featureId: args.featureId,
      }),
    [args.wsSessionId, args.sessionId, args.featureId],
  );
  const attachments = useImageAttachments(promptDropTargetId, args.providerId);
  useAttachmentDraftSync(
    attachmentDraftScope(args.featureId, promptDropTargetId),
    attachments.attachments,
    attachments.restoreAttachments,
  );
  return useMemo(() => ({ ...attachments, promptDropTargetId }), [attachments, promptDropTargetId]);
}
