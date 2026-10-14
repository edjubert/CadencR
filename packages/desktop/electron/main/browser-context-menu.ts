import {
  clipboard,
  Menu,
  type BrowserWindow,
  type ContextMenuParams,
  type MenuItemConstructorOptions,
  type WebContents,
} from "electron";

import { normalizeBrowserOpenUrl } from "./browser-policy";

interface BrowserContextMenuActions {
  openLinkInNewTab(url: string): void;
  inspectElement(x: number, y: number): void;
  reportError(error: unknown): void;
}

function guardedAction(
  contents: WebContents,
  reportError: (error: unknown) => void,
  action: () => void,
): () => void {
  return () => {
    try {
      if (contents.isDestroyed()) throw new Error("Browser tab is no longer available.");
      action();
    } catch (error) {
      reportError(error);
    }
  };
}

function safeBrowserLink(rawUrl: string): string | null {
  if (!rawUrl) return null;
  try {
    return normalizeBrowserOpenUrl(rawUrl);
  } catch {
    return null;
  }
}

/** Build Chromium-style guest actions whose callbacks always target the originating page. */
export function buildBrowserContextMenuTemplate(
  contents: WebContents,
  params: ContextMenuParams,
  actions: BrowserContextMenuActions,
): MenuItemConstructorOptions[] {
  const run = (action: () => void): (() => void) =>
    guardedAction(contents, actions.reportError, action);
  const items: MenuItemConstructorOptions[] = [
    { label: "Back", enabled: contents.canGoBack(), click: run(() => contents.goBack()) },
    { label: "Forward", enabled: contents.canGoForward(), click: run(() => contents.goForward()) },
    { label: "Reload", click: run(() => contents.reload()) },
    { type: "separator" },
  ];
  const linkUrl = safeBrowserLink(params.linkURL);
  if (linkUrl) {
    items.push(
      { label: "Open Link in New Tab", click: run(() => actions.openLinkInNewTab(linkUrl)) },
      { label: "Copy Link Address", click: run(() => clipboard.writeText(linkUrl)) },
      { type: "separator" },
    );
  }
  if (params.misspelledWord) {
    for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
      items.push({
        label: suggestion,
        click: run(() => contents.replaceMisspelling(suggestion)),
      });
    }
    if (params.dictionarySuggestions.length === 0) {
      items.push({ label: "No suggestions", enabled: false });
    }
    items.push({ type: "separator" });
  }
  items.push(
    { label: "Undo", enabled: params.editFlags.canUndo, click: run(() => contents.undo()) },
    { label: "Redo", enabled: params.editFlags.canRedo, click: run(() => contents.redo()) },
    { type: "separator" },
    { label: "Cut", enabled: params.editFlags.canCut, click: run(() => contents.cut()) },
    { label: "Copy", enabled: params.editFlags.canCopy, click: run(() => contents.copy()) },
    { label: "Paste", enabled: params.editFlags.canPaste, click: run(() => contents.paste()) },
    {
      label: "Select All",
      enabled: params.editFlags.canSelectAll,
      click: run(() => contents.selectAll()),
    },
    { type: "separator" },
    {
      label: "Inspect Element",
      click: run(() => actions.inspectElement(params.x, params.y)),
    },
  );
  return items;
}

export function installBrowserContextMenu(
  contents: WebContents,
  getWindow: () => BrowserWindow | null,
  actions: BrowserContextMenuActions,
): void {
  contents.on("context-menu", (event, params) => {
    event.preventDefault();
    try {
      if (contents.isDestroyed()) throw new Error("Browser tab is no longer available.");
      const window = getWindow();
      if (!window || window.isDestroyed()) throw new Error("Browser window is not available.");
      Menu.buildFromTemplate(buildBrowserContextMenuTemplate(contents, params, actions)).popup({
        window,
      });
    } catch (error) {
      actions.reportError(error);
    }
  });
}
