import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@/test-utils";
import { CodeBlockActionsContext } from "./CodeBlockActionsContext";
import { Markdown } from "./Markdown";
import {
  __markdownCacheTestHelpers as cache,
  markdownTreeCache,
} from "./markdown/markdown-tree-cache";
import { __highlightCacheTestHelpers as highlightCache } from "./markdown/highlight-cache";

const identity = (cacheKey: string, content: string) => ({
  cacheKey,
  content,
  sendToTerminal: undefined,
});

describe("Markdown — module-level tree cache", () => {
  beforeEach(() => {
    cache.clear();
    highlightCache.clear();
  });

  it("populates and reuses an entry for the same settled block", () => {
    const content = "# Cached heading\n\nWith body text.";
    render(<Markdown content={content} cacheKey="block-1" />);
    expect(cache.size()).toBe(1);
    expect(cache.has(identity("block-1", content))).toBe(true);

    cleanup();
    render(<Markdown content={content} cacheKey="block-1" />);
    expect(cache.size()).toBe(1);
  });

  it("keeps separate identities for distinct blocks with identical content", () => {
    const content = "Same content";
    render(<Markdown content={content} cacheKey="block-1" />);
    cleanup();
    render(<Markdown content={content} cacheKey="block-2" />);

    expect(cache.size()).toBe(2);
  });

  it("replaces stale content for one stable block identity", () => {
    const view = render(<Markdown content="first" cacheKey="block-1" />);
    view.rerender(<Markdown content="second" cacheKey="block-1" />);

    expect(cache.size()).toBe(1);
    expect(cache.has(identity("block-1", "first"))).toBe(false);
    expect(cache.has(identity("block-1", "second"))).toBe(true);
  });

  it("evicts old trees before retained content exceeds the weight budget", () => {
    for (let index = 0; index < 8; index += 1) {
      const content = `${index}${"x".repeat(300_000)}`;
      markdownTreeCache.getOrCreate(identity(`block-${index}`, content), () => <span />);
    }

    expect(cache.size()).toBeLessThan(8);
    expect(cache.weight()).toBeLessThanOrEqual(cache.maxWeight);
  });

  it("bypasses both caches for a keyed block explicitly marked streaming", () => {
    const content = "```typescript\nconst partial = true;\n";
    render(<Markdown content={content} cacheKey="streaming-block" isStreaming />);

    expect(cache.size()).toBe(0);
    expect(highlightCache.snapshot().size).toBe(0);
  });

  it("does not reuse a tree that captured a stale terminal callback", () => {
    const content = "```bash\necho safe\n```";
    const first = vi.fn();
    const second = vi.fn();
    const renderWith = (sendToTerminal: (command: string) => void) =>
      render(
        <CodeBlockActionsContext.Provider value={{ sendToTerminal }}>
          <Markdown content={content} cacheKey="shell-block" />
        </CodeBlockActionsContext.Provider>,
      );

    renderWith(first);
    cleanup();
    renderWith(second);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("echo safe\n");
    expect(cache.size()).toBe(2);
  });
});
