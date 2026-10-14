import type { ReadFileResponse } from "@/api/generated";

/**
 * Build a `ReadFileResponse` from freshly-saved text so the read-file query
 * cache can be reconciled without a refetch. Shared with `useExcalidrawSave`.
 */
export function readFileResponseFromContent(content: string, lineCount?: number): ReadFileResponse {
  const line_count = lineCount ?? countLines(content);
  return { content, line_count, large: false };
}

function countLines(content: string): number {
  const lines = content.split(/\r\n|\r|\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines.length;
}
