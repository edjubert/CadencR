/**
 * Agent type definitions for frontend components.
 */

import type { PromptAttachmentKind } from "@/lib/prompt-attachments";

export type AgentType = "session" | "auto_name";

/**
 * `source.type` marking an image whose payload was moved to the blob cache
 * (`lib/prompt-image-cache`). Lives here, with the rest of the envelope schema,
 * so the cache and the parser cannot drift apart on the wire format.
 */
export const PROMPT_BLOB_REF_TYPE = "cadencr_ref";

/** File payload sent with prompts to agents. */
export interface PromptAttachmentPayload {
  base64: string;
  fileName: string;
  kind: PromptAttachmentKind;
  mimeType: string;
}

export interface ParsedPromptAttachment {
  base64?: string;
  /** Set instead of `base64` once the payload was moved to `prompt-image-cache`. */
  ref?: string;
  fileName: string;
  kind: PromptAttachmentKind;
  mimeType: string;
}

export interface ParsedUserMessageImage {
  mediaType: string;
  /** Inline payload — present only while the image is still in the envelope. */
  base64?: string;
  /** Set instead of `base64` once the payload was moved to `prompt-image-cache`. */
  ref?: string;
}

interface ParsedUserMessageContent {
  text: string;
  images: ParsedUserMessageImage[];
  attachments: ParsedPromptAttachment[];
}

/**
 * One block as it actually arrives on the wire — every field optional, because
 * this is untrusted JSON. `UserMessageContentBlock` below is the strict shape
 * *we* write; this is the permissive shape everyone reading an envelope must
 * narrow from, including the blob cache's rewriting walk.
 */
export interface RawUserMessageBlock {
  type?: string;
  text?: string;
  file_name?: string;
  kind?: string;
  media_type?: string;
  data?: string;
  ref?: string;
  source?: { type?: string; media_type?: string; data?: string; ref?: string };
}

type UserMessageContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: string; data: string };
    }
  | {
      type: "attachment";
      file_name: string;
      kind: PromptAttachmentKind;
      media_type: string;
      data?: string;
    };

/** Build the `content` string for a user_message block (plain text or JSON with attachments). */
export function buildUserMessageContent(
  text: string,
  attachments?: PromptAttachmentPayload[],
): string {
  if (!attachments || attachments.length === 0) return text;
  const blocks: UserMessageContentBlock[] = text.length > 0 ? [{ type: "text", text }] : [];
  for (const attachment of attachments) {
    if (attachment.kind === "image") {
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: attachment.mimeType, data: attachment.base64 },
      });
      continue;
    }
    blocks.push({
      type: "attachment",
      file_name: attachment.fileName,
      kind: attachment.kind,
      media_type: attachment.mimeType,
      data: attachment.base64,
    });
  }
  return JSON.stringify(blocks);
}

export function parseUserMessageContent(content: string): ParsedUserMessageContent {
  if (!content.startsWith("[")) return { text: content, images: [], attachments: [] };

  try {
    const parsed = JSON.parse(content) as RawUserMessageBlock[];
    if (!Array.isArray(parsed)) {
      return { text: content, images: [], attachments: [] };
    }

    const text = parsed
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text ?? "")
      .join("\n");
    const images = parsed.flatMap((block): ParsedUserMessageImage[] => {
      const source = block.source;
      if (block.type !== "image" || typeof source?.media_type !== "string") return [];
      // A payload lifted into `prompt-image-cache` leaves a ref behind; an
      // envelope that was never off-loaded still carries its base64 inline.
      if (source.type === PROMPT_BLOB_REF_TYPE && typeof source.ref === "string") {
        return [{ mediaType: source.media_type, ref: source.ref }];
      }
      if (typeof source.data !== "string") return [];
      return [{ mediaType: source.media_type, base64: source.data }];
    });
    const attachments = parsed.flatMap((block) => {
      if (
        block.type !== "attachment" ||
        typeof block.file_name !== "string" ||
        !isPromptAttachmentKind(block.kind) ||
        typeof block.media_type !== "string"
      ) {
        return [];
      }
      return [
        {
          ...(typeof block.data === "string" ? { base64: block.data } : {}),
          ...(typeof block.ref === "string" ? { ref: block.ref } : {}),
          fileName: block.file_name,
          kind: block.kind,
          mimeType: block.media_type,
        },
      ];
    });

    return { text, images, attachments };
  } catch {
    return { text: content, images: [], attachments: [] };
  }
}

function isPromptAttachmentKind(kind: unknown): kind is PromptAttachmentKind {
  return (
    kind === "image" ||
    kind === "document" ||
    kind === "text" ||
    kind === "audio" ||
    kind === "resource"
  );
}

/** Extract only the text portion from a persisted user_message block. */
export function extractUserMessageText(content: string): string {
  return parseUserMessageContent(content).text;
}
