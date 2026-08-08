/**
 * Unsent prompt attachments, held per feature for the lifetime of the window.
 *
 * Draft *text* is persisted server-side in `feature_settings.draft_prompt`, but
 * attachments cannot follow it there: a single pasted screenshot is megabytes
 * of base64, and `feature_settings` is fetched whole every time a feature is
 * opened — persisting it would put that payload on the critical path of every
 * feature switch, and grow the database by a copy per draft.
 *
 * So attachments live in memory instead, which is what the missing behaviour
 * actually needs: leaving a conversation and coming back keeps the image, since
 * that only unmounts the prompt bar. A full app restart still drops them.
 *
 * Ownership is a hand-off, not a copy: `takeAttachmentDraft` removes the entry,
 * so a stored draft is by construction one that no mounted prompt bar is
 * showing. That is what makes revoking preview URLs on eviction safe.
 */
import type { ImageAttachment } from "@/hooks/useImageAttachments";

/**
 * Each draft can hold up to `MAX_FILES` × `MAX_SIZE_BYTES` (10 × 20 MB) of
 * base64 plus its preview blobs, so the map has to be bounded — a session that
 * touches hundreds of features would otherwise pin every image it ever saw.
 * Oldest-written drafts go first.
 */
const MAX_SCOPES = 8;

const drafts = new Map<string, ImageAttachment[]>();

/** Stable empty result: a fresh `[]` per miss would re-render every restore. */
const NO_ATTACHMENTS: ImageAttachment[] = [];

/**
 * Scope key for a prompt bar's attachment draft. Feature-scoped to match how
 * `usePromptDraft` scopes the text, so the two halves of one draft cannot end
 * up keyed differently across a session-id change (`/clear`, rewind, reconnect).
 */
export function attachmentDraftScope(featureId: number | null | undefined, fallback: string) {
  return featureId != null ? `feature:${featureId}` : fallback;
}

function releaseDraft(attachments: ImageAttachment[]): void {
  for (const attachment of attachments) {
    if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
  }
}

/** Hand a stored draft back to a prompt bar, transferring ownership to it. */
export function takeAttachmentDraft(scope: string): ImageAttachment[] {
  const stored = drafts.get(scope);
  if (!stored) return NO_ATTACHMENTS;
  drafts.delete(scope);
  return stored;
}

export function writeAttachmentDraft(scope: string, attachments: ImageAttachment[]): void {
  drafts.delete(scope);
  if (attachments.length === 0) return;
  drafts.set(scope, attachments);
  while (drafts.size > MAX_SCOPES) {
    const [oldest, evicted] = drafts.entries().next().value as [string, ImageAttachment[]];
    drafts.delete(oldest);
    releaseDraft(evicted);
  }
}

/** Test-only — production keeps drafts until the window closes. */
export function resetAttachmentDraftsForTest(): void {
  drafts.clear();
}
