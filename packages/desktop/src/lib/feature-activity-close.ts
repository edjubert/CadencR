/**
 * Noun describing a feature's live activity (running terminals and/or open
 * browser tabs) for the sidebar "Close …" action. Shared by the context-menu
 * item and the toast wording so they always agree. Callers must only invoke it
 * when at least one count is positive.
 */
export function closeFeatureActivityNoun(
  shellCount: number,
  browserCount: number,
  downloadCount = 0,
): string {
  const hasShells = shellCount > 0;
  const hasBrowsers = browserCount > 0;
  const browserActivity =
    hasShells && hasBrowsers
      ? "terminals & browsers"
      : hasShells
        ? shellCount === 1
          ? "terminal"
          : "terminals"
        : hasBrowsers
          ? browserCount === 1
            ? "browser tab"
            : "browser tabs"
          : "";
  if (downloadCount <= 0) return browserActivity;
  const downloads = downloadCount === 1 ? "download" : "downloads";
  return browserActivity ? `${browserActivity} & ${downloads}` : downloads;
}
