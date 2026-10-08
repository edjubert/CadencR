import { beforeEach, describe, expect, it } from "vitest";
import { highlightCode, __highlightCacheTestHelpers as cache } from "./highlight-cache";

describe("settled syntax-highlight cache", () => {
  beforeEach(() => cache.clear());

  it("reuses the same highlighted React tree for settled code", () => {
    const first = highlightCode("typescript", "const answer = 42;");
    const second = highlightCode("typescript", "const answer = 42;");

    expect(second).toBe(first);
    expect(cache.snapshot().size).toBe(1);
  });

  it("does not retain uncached streaming versions", () => {
    for (let version = 0; version < 60; version += 1) {
      highlightCode("typescript", `const answer = 42; // ${version}`, { cache: false });
    }

    expect(cache.snapshot()).toEqual({ size: 0, weight: 0 });
  });

  it("refreshes LRU recency and evicts by total weight", () => {
    const lru = cache.create(10);
    lru.set("old", "old", 4);
    lru.set("recent", "recent", 4);
    expect(lru.get("old")).toBe("old");
    lru.set("new", "new", 4);

    expect(lru.has("old")).toBe(true);
    expect(lru.has("recent")).toBe(false);
    expect(lru.has("new")).toBe(true);
    expect(lru.snapshot()).toEqual({ size: 2, weight: 8 });
  });

  it("bypasses an oversized singleton without evicting useful entries", () => {
    const lru = cache.create(10);
    lru.set("kept", "kept", 5);
    lru.set("oversized", "oversized", 11);

    expect(lru.has("kept")).toBe(true);
    expect(lru.has("oversized")).toBe(false);
    expect(lru.snapshot()).toEqual({ size: 1, weight: 5 });
  });

  it("accounts for UTF-8 bytes and syntax-tree node overhead", () => {
    const ascii = cache.estimateWeight("text", "e", { type: "root", children: [] });
    const unicode = cache.estimateWeight("text", "é", { type: "root", children: [] });
    const nested = cache.estimateWeight("text", "e", {
      type: "root",
      children: [{ type: "element", children: [{ type: "text", value: "e" }] }],
    });

    expect(unicode).toBe(ascii + 1);
    expect(nested).toBeGreaterThan(ascii + 2 * 96);
  });
});
