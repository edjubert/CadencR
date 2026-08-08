import { useGlobalShortcutById, useShortcut } from "@/hooks/useShortcut";
import { isInCodeMirrorEditor } from "@/lib/shortcuts/dom-targets";
import type { GitActionState, GitActivities } from "./useGitAction";

interface GitActionShortcutOptions {
  state: GitActionState;
  activities: GitActivities;
  openCommit: () => void;
  openPush: () => void;
  openCompare: () => Promise<void>;
  openPopover: () => void;
}

export function useGitActionShortcuts(options: GitActionShortcutOptions): void {
  useShortcut("git-commit", (event) => {
    if (isInCodeMirrorEditor(event.target)) return;
    if (!options.activities.commit && options.state.disabled.commit !== null) return;
    event.preventDefault();
    options.openCommit();
  });
  useShortcut("git-push", (event) => {
    // A backgrounded push stays reachable even when the snapshot now says
    // "Nothing to push" — the shortcut reopens the running/failed output.
    if (!options.activities.push && options.state.disabled.push !== null) return;
    event.preventDefault();
    options.openPush();
  });
  useShortcut("git-pr", (event) => {
    if (options.state.disabled.pr !== null) return;
    event.preventDefault();
    void options.openCompare();
  });
  useGlobalShortcutById("git-actions", (event) => {
    event.preventDefault();
    options.openPopover();
  });
}
