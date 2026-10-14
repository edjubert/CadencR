import { describe, expect, it } from "vitest";
import type { BrowserTabMetadata } from "@/shared/browser-types";
import { buildOmniboxSuggestions, resolveOmniboxInput } from "./browser-omnibox";

describe("resolveOmniboxInput", () => {
  it.each([
    ["example.com", "https://example.com/"],
    ["example.com:8080/path", "https://example.com:8080/path"],
    ["//example.com/path", "https://example.com/path"],
    ["localhost:9336", "http://localhost:9336/"],
    ["localhost.", "http://localhost./"],
    ["dev.localhost:3000/path", "http://dev.localhost:3000/path"],
    ["127.0.0.1", "http://127.0.0.1/"],
    ["192.168.1.2:3000", "http://192.168.1.2:3000/"],
    ["172.20.4.2", "http://172.20.4.2/"],
    ["[::1]:9336", "http://[::1]:9336/"],
    ["[::ffff:127.0.0.1]:9336", "http://[::ffff:7f00:1]:9336/"],
    ["8.8.8.8", "https://8.8.8.8/"],
    ["fda.gov", "https://fda.gov/"],
    ["fcc.gov", "https://fcc.gov/"],
    ["fdroid.org", "https://fdroid.org/"],
    ["fe80.example", "https://fe80.example/"],
  ])("normalizes host %s", (input, expected) => {
    expect(resolveOmniboxInput(input)).toEqual({ kind: "url", url: expected });
  });

  it("preserves explicit schemes, encodes spaces, and strips credentials", () => {
    expect(resolveOmniboxInput("http://example.com/path")).toEqual({
      kind: "url",
      url: "http://example.com/path",
    });
    expect(resolveOmniboxInput("https://alice:secret@example.com/a path")).toEqual({
      kind: "url",
      url: "https://example.com/a%20path",
    });
    expect(resolveOmniboxInput("file:///tmp/example.html")).toEqual({
      kind: "url",
      url: "file:///tmp/example.html",
    });
    expect(resolveOmniboxInput("about:blank")).toEqual({ kind: "url", url: "about:blank" });
    expect(resolveOmniboxInput("/Users/alice/My File.html")).toEqual({
      kind: "url",
      url: "/Users/alice/My File.html",
    });
  });

  it.each([
    "javascript:alert(1)",
    "data:text/plain,secret",
    "mailto:user@example.com",
    "about:config",
  ])("blocks explicit unsafe scheme %s instead of searching it", (input) =>
    expect(() => resolveOmniboxInput(input)).toThrow("blocked"),
  );

  it("searches text even when it contains a dotted token", () => {
    expect(resolveOmniboxInput("how to use foo.bar", "duckduckgo")).toEqual({
      kind: "search",
      query: "how to use foo.bar",
      url: "https://duckduckgo.com/?q=how%20to%20use%20foo.bar",
    });
  });
});

describe("buildOmniboxSuggestions", () => {
  const tab: BrowserTabMetadata = {
    id: "tab-1",
    title: "Example open tab",
    url: "https://example.com/docs",
    loading: false,
    canGoBack: false,
    canGoForward: false,
    sessionProfileId: "fresh",
    isActive: true,
    devToolsOpen: false,
    pinned: false,
    suspended: false,
    zoomPercent: 100,
    responsive: {
      enabled: false,
      preset: "mobile",
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      mobile: true,
      touch: true,
      colorScheme: "system",
      status: "ready",
    },
    scopeId: 7,
  };

  it("deduplicates open tabs, bookmarks, and history with source priority", () => {
    const suggestions = buildOmniboxSuggestions(
      "example",
      [tab],
      {
        bookmarkCount: 1,
        bookmarks: [
          {
            id: "bookmark-1",
            title: "Example bookmark",
            url: tab.url,
            createdAt: "2026-09-07T12:00:00.000Z",
          },
        ],
        historyCount: 2,
        history: [
          {
            id: "history-1",
            title: "Example history",
            url: tab.url,
            visitedAt: "2026-09-07T12:00:00.000Z",
          },
          {
            id: "history-2",
            title: "Other result",
            url: "https://example.net/",
            visitedAt: "2026-09-07T11:00:00.000Z",
          },
        ],
      },
      "google",
    );

    expect(suggestions.map((suggestion) => suggestion.source)).toEqual([
      "search",
      "tab",
      "history",
    ]);
    expect(suggestions.filter((suggestion) => suggestion.url === tab.url)).toHaveLength(1);
  });

  it("never includes more than eight local suggestions", () => {
    const history = Array.from({ length: 20 }, (_, index) => ({
      id: `history-${index}`,
      title: `Page ${index}`,
      url: `https://example.com/${index}`,
      visitedAt: "2026-09-07T12:00:00.000Z",
    }));
    expect(
      buildOmniboxSuggestions(
        "page",
        [],
        { bookmarkCount: 0, bookmarks: [], historyCount: history.length, history },
        "google",
      ),
    ).toHaveLength(8);
  });
});
