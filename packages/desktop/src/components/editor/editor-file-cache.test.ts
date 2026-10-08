import { describe, expect, it } from "vitest";
import { readFileResponseFromContent } from "./editor-file-cache";

describe("saved file metadata", () => {
  it.each([
    ["", 0],
    ["one", 1],
    ["one\n", 1],
    ["one\r\ntwo\r\n", 2],
    ["one\rtwo", 2],
  ])("counts lines for non-CodeMirror content %j", (content, lineCount) => {
    expect(readFileResponseFromContent(content)).toEqual({
      content,
      line_count: lineCount,
      large: false,
    });
  });
  it("uses an existing line count without recomputing it", () => {
    expect(readFileResponseFromContent("text", 42).line_count).toBe(42);
  });
});
