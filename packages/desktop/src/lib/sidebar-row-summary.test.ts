import { describe, expect, it } from "vitest";
import { hasOpenTodos, rowLayout } from "@/lib/sidebar-row-summary";

const options = {
  compactRows: false,
  uniformRows: true,
  titleLines: "one",
  preview: "none",
  todos: false,
  pendingRequest: true,
} as const;

describe("rowLayout", () => {
  it("folds the details beside a one-line title", () => {
    expect(rowLayout(options, "idle", false)).toEqual({
      compact: false,
      foldMeta: true,
      showsPreview: false,
      showsTodos: false,
    });
  });

  it("keeps the details on their own line for two-line titles and label edits", () => {
    expect(rowLayout({ ...options, titleLines: "two" }, "idle", false).foldMeta).toBe(false);
    expect(rowLayout(options, "idle", true).foldMeta).toBe(false);
    expect(rowLayout({ ...options, uniformRows: false }, "idle", false).foldMeta).toBe(false);
  });

  it("grows a compact row back while its conversation waits", () => {
    const compact = { ...options, compactRows: true };
    expect(rowLayout(compact, "working", false).compact).toBe(true);
    expect(rowLayout(compact, "unread", false).compact).toBe(true);
    expect(rowLayout(compact, "waiting", false).compact).toBe(false);
  });

  it("shows the preview and todos only when asked to, never on a compact row", () => {
    const both = { ...options, preview: "last_message", todos: true } as const;
    expect(rowLayout(both, "idle", false)).toMatchObject({ showsPreview: true, showsTodos: true });
    expect(rowLayout({ ...both, compactRows: true }, "idle", false)).toMatchObject({
      showsPreview: false,
      showsTodos: false,
    });
  });

  it("gives the preview's line to a pending request", () => {
    const preview = { ...options, preview: "last_message" } as const;
    expect(rowLayout(preview, "waiting", false).showsPreview).toBe(false);
    expect(rowLayout({ ...preview, pendingRequest: false }, "waiting", false).showsPreview).toBe(
      true,
    );
  });
});

describe("hasOpenTodos", () => {
  it("counts a list only while some todos are left", () => {
    expect(hasOpenTodos({ done: 3, total: 7 })).toBe(true);
    expect(hasOpenTodos({ done: 7, total: 7 })).toBe(false);
    expect(hasOpenTodos({ done: 0, total: 0 })).toBe(false);
    expect(hasOpenTodos(null)).toBe(false);
  });
});
