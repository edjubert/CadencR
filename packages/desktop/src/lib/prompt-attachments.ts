import { PROVIDER_IDS } from "./providers";

export type PromptAttachmentKind = "image" | "document" | "text" | "audio" | "resource";

export const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
const AUDIO_MIME_TYPES = ["audio/wav", "audio/mpeg", "audio/mp3", "audio/ogg"] as const;
const PDF_MIME_TYPES = ["application/pdf"] as const;
const TEXT_MIME_TYPES = [
  "text/plain",
  "text/csv",
  "text/markdown",
  "text/html",
  "text/xml",
  "application/json",
  "application/xml",
  "application/csv",
] as const;
const OFFICE_MIME_TYPES = [
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/rtf",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
] as const;

const EXTENSION_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  tsv: "text/tsv",
  json: "application/json",
  html: "text/html",
  htm: "text/html",
  xml: "application/xml",
  log: "text/plain",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  rtf: "application/rtf",
  odt: "application/vnd.oasis.opendocument.text",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/**
 * First extension registered for a MIME type — the inverse of the map above,
 * used to name a downloaded file. `jpg` wins over `jpeg` by insertion order.
 */
export function extensionForMime(mimeType: string): string | undefined {
  return Object.keys(EXTENSION_TO_MIME).find((ext) => EXTENSION_TO_MIME[ext] === mimeType);
}

export function normalizeAttachmentMime(fileName: string, mimeType: string): string {
  if (mimeType) return mimeType;
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_TO_MIME[extension] ?? "application/octet-stream";
}

export function getAttachmentKindForProvider(
  providerId: string | undefined,
  fileName: string,
  mimeType: string,
): PromptAttachmentKind | null {
  const provider = providerId ?? PROVIDER_IDS.CODEX_CLI;
  const normalized = normalizeAttachmentMime(fileName, mimeType);
  if (isImageMime(normalized)) return "image";
  if (provider === PROVIDER_IDS.CODEX_CLI) return isPdfMime(normalized) ? "document" : null;
  if (provider === PROVIDER_IDS.CURSOR) return null;
  if (provider === PROVIDER_IDS.OPENCODE) return opencodeKind(normalized);
  return claudeKind(normalized);
}

export function attachmentAcceptForProvider(providerId: string | undefined): string {
  const provider = providerId ?? PROVIDER_IDS.CODEX_CLI;
  const base = [...IMAGE_MIME_TYPES];
  if (provider === PROVIDER_IDS.CODEX_CLI) return [...base, ...PDF_MIME_TYPES].join(",");
  if (provider === PROVIDER_IDS.CURSOR) return base.join(",");
  if (provider === PROVIDER_IDS.OPENCODE) {
    return [
      ...base,
      ...AUDIO_MIME_TYPES,
      ...PDF_MIME_TYPES,
      ...TEXT_MIME_TYPES,
      ...OFFICE_MIME_TYPES,
    ].join(",");
  }
  return [...base, ...PDF_MIME_TYPES, ...TEXT_MIME_TYPES].join(",");
}

export function unsupportedAttachmentDescription(providerId: string | undefined): string {
  if (providerId === PROVIDER_IDS.OPENCODE) {
    return "OpenCode accepts images, audio, PDFs, text files, and common document resources.";
  }
  if (providerId === PROVIDER_IDS.CLAUDE_CODE) {
    return "Claude accepts images, PDFs, and text-like files such as TXT, CSV, Markdown, and JSON.";
  }
  if (providerId === PROVIDER_IDS.CURSOR) {
    return "Cursor ACP accepts image attachments.";
  }
  return "Codex accepts images and PDFs.";
}

function opencodeKind(mimeType: string): PromptAttachmentKind | null {
  if (isAudioMime(mimeType)) return "audio";
  if (isTextMime(mimeType) || isPdfMime(mimeType) || isOfficeMime(mimeType)) return "resource";
  return null;
}

function claudeKind(mimeType: string): PromptAttachmentKind | null {
  if (isPdfMime(mimeType) || mimeType === "text/plain") return "document";
  if (isTextMime(mimeType)) return "text";
  return null;
}

function isImageMime(mimeType: string): boolean {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
}

function isAudioMime(mimeType: string): boolean {
  return (AUDIO_MIME_TYPES as readonly string[]).includes(mimeType);
}

function isPdfMime(mimeType: string): boolean {
  return (PDF_MIME_TYPES as readonly string[]).includes(mimeType);
}

function isTextMime(mimeType: string): boolean {
  return mimeType.startsWith("text/") || (TEXT_MIME_TYPES as readonly string[]).includes(mimeType);
}

function isOfficeMime(mimeType: string): boolean {
  return (OFFICE_MIME_TYPES as readonly string[]).includes(mimeType);
}
