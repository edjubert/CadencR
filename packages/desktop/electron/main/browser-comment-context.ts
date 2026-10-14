import {
  addCommentBadgeScript,
  clearCommentBadgesScript,
  removeCommentBadgeScript,
} from "./browser-comment-overlay-script";
import { captureElementContext } from "./browser-dom";
import { waitForLoad } from "./browser-interactions";
import { tabDiagnostics } from "./browser-manager-utils";
import { browserScreenshotClipScale } from "./browser-screenshot";
import type { ManagedTab } from "./browser-tab-events";
import type { BrowserElementContext } from "./browser-types";

type SelectionAttempt =
  | { kind: "selected"; context: BrowserElementContext }
  | { kind: "navigated" };

function captureUntilNavigation(
  tab: ManagedTab,
  anchorId: string | null,
): Promise<SelectionAttempt> {
  const contents = tab.webContents;
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      contents.off("did-start-navigation", onNavigation);
      contents.off("destroyed", onDestroyed);
    };
    const finish = (attempt: SelectionAttempt): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(attempt);
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onNavigation = (
      _event: Electron.Event,
      _url: string,
      isInPlace: boolean,
      isMainFrame: boolean,
    ): void => {
      if (isMainFrame && !isInPlace) finish({ kind: "navigated" });
    };
    const onDestroyed = (): void => fail(new Error("Browser tab closed during element selection."));

    contents.on("did-start-navigation", onNavigation);
    contents.once("destroyed", onDestroyed);
    void captureElementContext(
      contents,
      {
        tabId: tab.metadata.id,
        url: tab.metadata.url,
        title: tab.metadata.title,
        capturedAt: new Date().toISOString(),
      },
      tabDiagnostics(tab.consoleEntries, tab.networkEntries),
      anchorId,
      () => browserScreenshotClipScale(tab),
    ).then((context) => finish({ kind: "selected", context }), fail);
  });
}

export async function selectElementContext(
  tab: ManagedTab,
  anchorId?: string,
): Promise<BrowserElementContext> {
  const resolvedAnchorId = anchorId ?? null;
  while (true) {
    const attempt = await captureUntilNavigation(tab, resolvedAnchorId);
    if (attempt.kind === "navigated") {
      // A navigation destroys the page world that owns the picker promise.
      // Wait for the replacement document, then arm the picker there while the
      // renderer keeps showing the existing visible "picking" state.
      await waitForLoad(tab.webContents);
      continue;
    }
    // Pin a numbered badge to the element the user just picked. The agent/MCP
    // path passes no anchor and gets context without a badge.
    if (anchorId) {
      await tab.webContents.executeJavaScript(addCommentBadgeScript(anchorId), true);
    }
    return attempt.context;
  }
}

export async function removeCommentBadge(tab: ManagedTab, anchorId: string): Promise<void> {
  await tab.webContents.executeJavaScript(removeCommentBadgeScript(anchorId), true);
}

export async function clearCommentBadges(tab: ManagedTab): Promise<void> {
  await tab.webContents.executeJavaScript(clearCommentBadgesScript(), true);
}
