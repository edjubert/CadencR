import { describe, expect, it } from "vitest";
import { BLOCK_CONTENT_MAX_CHARS, TRUNCATION_NOTICE } from "@/lib/block-content-budget";
import {
  createStructuredToolStream,
  pendingStructuredToolContent,
  pushStructuredToolChunk,
} from "./ws-structured-tool-stream";

describe("structured tool stream", () => {
  it("recognizes nested JSON and escapes split across chunks", () => {
    const stream = createStructuredToolStream();
    expect(pushStructuredToolChunk(stream, '{"value":"brace } and slash \\').completed).toEqual([]);
    const result = pushStructuredToolChunk(stream, '"","nested":[{"ok":true}]}');
    expect(result.completed).toEqual(['{"value":"brace } and slash \\"","nested":[{"ok":true}]}']);
    expect(JSON.parse(result.completed[0])).toEqual({
      value: 'brace } and slash "',
      nested: [{ ok: true }],
    });
  });

  it("returns each concatenated snapshot without rescanning prior input", () => {
    const stream = createStructuredToolStream();
    const result = pushStructuredToolChunk(stream, '{"step":1}{"step":2}');
    expect(result.completed).toEqual(['{"step":1}', '{"step":2}']);
  });

  it("retains malformed pending input for a one-time finalization attempt", () => {
    const stream = createStructuredToolStream();
    pushStructuredToolChunk(stream, '{"path":"unterminated');
    expect(pendingStructuredToolContent(stream)).toBe('{"path":"unterminated');
  });

  it("freezes a truncated preview instead of reclamping it for every later chunk", () => {
    const stream = createStructuredToolStream();
    const first = pushStructuredToolChunk(
      stream,
      `{"content":"${"x".repeat(BLOCK_CONTENT_MAX_CHARS)}`,
    );
    const second = pushStructuredToolChunk(stream, "more streamed content");

    expect(first.preview.truncated).toBe(true);
    expect(first.preview.text).toContain(TRUNCATION_NOTICE);
    expect(second.preview).toBe(first.preview);
  });
});
