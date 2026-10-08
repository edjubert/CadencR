import type { ContextMenuParams, WebContents } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { buildFromTemplate, writeText } = vi.hoisted(() => ({
  buildFromTemplate: vi.fn(() => ({ popup: vi.fn() })),
  writeText: vi.fn(),
}));
vi.mock("electron", () => ({
  clipboard: { writeText },
  Menu: { buildFromTemplate },
}));

import { buildBrowserContextMenuTemplate, installBrowserContextMenu } from "./browser-context-menu";

function contextParams(overrides: Partial<ContextMenuParams> = {}): ContextMenuParams {
  return {
    x: 12,
    y: 34,
    linkURL: "",
    misspelledWord: "",
    dictionarySuggestions: [],
    editFlags: {
      canUndo: true,
      canRedo: false,
      canCut: true,
      canCopy: true,
      canPaste: true,
      canDelete: false,
      canSelectAll: true,
      canEditRichly: false,
    },
    ...overrides,
  } as ContextMenuParams;
}

function fakeContents(): WebContents {
  return {
    canGoBack: vi.fn(() => true),
    canGoForward: vi.fn(() => false),
    isDestroyed: vi.fn(() => false),
    goBack: vi.fn(),
    goForward: vi.fn(),
    reload: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    cut: vi.fn(),
    copy: vi.fn(),
    paste: vi.fn(),
    selectAll: vi.fn(),
    replaceMisspelling: vi.fn(),
  } as unknown as WebContents;
}

describe("buildBrowserContextMenuTemplate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports an action failure exactly once", () => {
    const reportError = vi.fn();
    const items = buildBrowserContextMenuTemplate(
      fakeContents(),
      contextParams({ linkURL: "https://example.com" }),
      {
        openLinkInNewTab: () => {
          throw new Error("Tab creation failed");
        },
        inspectElement: vi.fn(),
        reportError,
      },
    );
    items
      .find((item) => item.label === "Open Link in New Tab")
      ?.click?.(undefined as never, undefined as never, undefined as never);
    expect(reportError).toHaveBeenCalledOnce();
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Tab creation failed" }),
    );
  });

  it("bounds spelling suggestions and targets replacement at the guest", () => {
    const contents = fakeContents();
    const actions = { openLinkInNewTab: vi.fn(), inspectElement: vi.fn(), reportError: vi.fn() };
    const items = buildBrowserContextMenuTemplate(
      contents,
      contextParams({
        misspelledWord: "mistak",
        dictionarySuggestions: ["mistake", "mist", "misty", "mistook", "mistakes", "excluded"],
      }),
      actions,
    );
    expect(items.some((item) => item.label === "excluded")).toBe(false);
    items
      .find((item) => item.label === "mistake")
      ?.click?.(undefined as never, undefined as never, undefined as never);
    expect(contents.replaceMisspelling).toHaveBeenCalledWith("mistake");
    const empty = buildBrowserContextMenuTemplate(
      contents,
      contextParams({ misspelledWord: "mistak" }),
      actions,
    );
    expect(empty.find((item) => item.label === "No suggestions")?.enabled).toBe(false);
  });

  it("targets navigation and editing actions at the originating guest", () => {
    const contents = fakeContents();
    const inspectElement = vi.fn();
    const items = buildBrowserContextMenuTemplate(contents, contextParams(), {
      openLinkInNewTab: vi.fn(),
      inspectElement,
      reportError: vi.fn(),
    });

    items
      .find((item) => item.label === "Back")
      ?.click?.(undefined as never, undefined as never, undefined as never);
    items
      .find((item) => item.label === "Copy")
      ?.click?.(undefined as never, undefined as never, undefined as never);
    items
      .find((item) => item.label === "Inspect Element")
      ?.click?.(undefined as never, undefined as never, undefined as never);

    expect(contents.goBack).toHaveBeenCalledOnce();
    expect(contents.copy).toHaveBeenCalledOnce();
    expect(inspectElement).toHaveBeenCalledWith(12, 34);
    expect(items.find((item) => item.label === "Forward")?.enabled).toBe(false);
    expect(items.find((item) => item.label === "Redo")?.enabled).toBe(false);
  });

  it("normalizes safe links and omits blocked schemes", () => {
    const contents = fakeContents();
    const openLinkInNewTab = vi.fn();
    const safeItems = buildBrowserContextMenuTemplate(
      contents,
      contextParams({ linkURL: "https://user:secret@example.com/path" }),
      { openLinkInNewTab, inspectElement: vi.fn(), reportError: vi.fn() },
    );
    safeItems
      .find((item) => item.label === "Open Link in New Tab")
      ?.click?.(undefined as never, undefined as never, undefined as never);
    safeItems
      .find((item) => item.label === "Copy Link Address")
      ?.click?.(undefined as never, undefined as never, undefined as never);

    expect(openLinkInNewTab).toHaveBeenCalledWith("https://example.com/path");
    expect(writeText).toHaveBeenCalledWith("https://example.com/path");

    const blockedItems = buildBrowserContextMenuTemplate(
      contents,
      contextParams({ linkURL: "javascript:alert(1)" }),
      { openLinkInNewTab, inspectElement: vi.fn(), reportError: vi.fn() },
    );
    expect(blockedItems.some((item) => item.label === "Open Link in New Tab")).toBe(false);
  });

  it("reports stale guest actions instead of calling destroyed WebContents", () => {
    const contents = fakeContents();
    vi.mocked(contents.isDestroyed).mockReturnValue(true);
    const reportError = vi.fn();
    const items = buildBrowserContextMenuTemplate(contents, contextParams(), {
      openLinkInNewTab: vi.fn(),
      inspectElement: vi.fn(),
      reportError,
    });

    items
      .find((item) => item.label === "Reload")
      ?.click?.(undefined as never, undefined as never, undefined as never);

    expect(contents.reload).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.any(String) }),
    );
  });
});

describe("installBrowserContextMenu", () => {
  it("prevents the guest default and reports menu construction failures", () => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const contents = {
      ...fakeContents(),
      on: vi.fn((name: string, handler: (...args: unknown[]) => void) =>
        handlers.set(name, handler),
      ),
    } as unknown as WebContents;
    const reportError = vi.fn();
    buildFromTemplate.mockImplementationOnce(() => {
      throw new Error("menu failed");
    });
    installBrowserContextMenu(contents, () => ({ isDestroyed: () => false }) as never, {
      openLinkInNewTab: vi.fn(),
      inspectElement: vi.fn(),
      reportError,
    });
    const event = { preventDefault: vi.fn() };

    handlers.get("context-menu")?.(event, contextParams());

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ message: "menu failed" }));
  });
});
