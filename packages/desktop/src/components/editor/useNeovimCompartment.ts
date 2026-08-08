import { useEffect, type RefObject } from "react";
import { Compartment } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { subscribeToNeovimEvents } from "@/stores/ws-neovim-store";
import { toNeovimKeyNotation } from "./neovim-key-notation";
import { sendNeovimKeyInput } from "./neovim-ws-send";

interface UseNeovimCompartmentArgs {
  viewRef: RefObject<EditorView | null>;
  neovimCompartment: RefObject<Compartment>;
  isNeovimIntegrated: boolean;
  featureId?: string;
  filePath?: string;
  onModeChanged?: (mode: string) => void;
}

/**
 * Built once for the initial extensions array (`BaseCodeMirrorEditor`'s mount
 * effect) and again here on every reconfigure, so both take the exact same
 * shape whether `isNeovimIntegrated` is already `true` at mount or flips on
 * later — mirrors `vimCompartment.current.of(vimMode ? vim() : [])`'s pattern
 * of deriving the initial compartment content straight from props.
 */
export function neovimKeydownExtension(featureId: string, filePath: string) {
  return EditorView.domEventHandlers({
    keydown(event) {
      const keys = toNeovimKeyNotation(event);
      sendNeovimKeyInput(featureId, filePath, keys);
      event.preventDefault();
      return true;
    },
  });
}

function applyCursorMoved(view: EditorView, line: number, col: number): void {
  const clampedLine = Math.min(Math.max(line, 1), view.state.doc.lines);
  const lineInfo = view.state.doc.line(clampedLine);
  const anchor = Math.min(lineInfo.from + col, lineInfo.to);
  view.dispatch({ selection: { anchor } });
}

function applyBufferLinesChanged(
  view: EditorView,
  firstline: number,
  lastline: number,
  lines: string[],
): void {
  const doc = view.state.doc;
  const from = doc.line(Math.min(firstline + 1, doc.lines)).from;
  const to = lastline === -1 ? doc.length : doc.line(Math.min(lastline + 1, doc.lines)).from;
  view.dispatch({ changes: { from, to, insert: lines.join("\n") } });
}

/** Reconfigure the compartment on every keydown-relevant prop change (view already exists past mount). */
function useNeovimKeydownReconfigure(
  viewRef: RefObject<EditorView | null>,
  neovimCompartment: RefObject<Compartment>,
  isNeovimIntegrated: boolean,
  featureId: string | undefined,
  filePath: string | undefined,
): void {
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const extension =
      isNeovimIntegrated && featureId && filePath
        ? neovimKeydownExtension(featureId, filePath)
        : [];
    view.dispatch({ effects: neovimCompartment.current.reconfigure(extension) });
  }, [featureId, filePath, isNeovimIntegrated, neovimCompartment, viewRef]);
}

/**
 * Subscribes to incoming neovim WS events for the active (feature, file)
 * pair. Deliberately does not gate on `viewRef.current` at effect-setup time
 * — unlike the keydown reconfigure above, the subscription doesn't dispatch
 * anything itself; each handler reads `viewRef.current` lazily when an event
 * actually arrives, so it's set up correctly even on the very first render
 * (before the mount effect that creates the EditorView has run).
 */
function useNeovimEventSubscription(
  viewRef: RefObject<EditorView | null>,
  isNeovimIntegrated: boolean,
  featureId: string | undefined,
  filePath: string | undefined,
  onModeChanged: ((mode: string) => void) | undefined,
): void {
  useEffect(() => {
    if (!isNeovimIntegrated || !featureId || !filePath) return;

    return subscribeToNeovimEvents(featureId, filePath, {
      onCursorMoved: (line, col) => {
        const view = viewRef.current;
        if (view) applyCursorMoved(view, line, col);
      },
      onModeChanged: (mode) => onModeChanged?.(mode),
      onBufferLinesChanged: (firstline, lastline, lines) => {
        const view = viewRef.current;
        if (view) applyBufferLinesChanged(view, firstline, lastline, lines);
      },
    });
  }, [featureId, filePath, isNeovimIntegrated, onModeChanged, viewRef]);
}

/**
 * `neovimCompartment` — mirrors the `vimCompartment` pattern in
 * `BaseCodeMirrorEditor.tsx` (declared there, included in the initial
 * extensions array via `neovimKeydownExtension`), active only at vim-mode
 * level 2. Captures keydown and forwards it as `key_input` over WS (Task 6's
 * `toNeovimKeyNotation`, `neovim-ws-send.ts`), and applies incoming
 * `cursor_moved`/`buffer_lines_changed` events (Task 7's
 * `subscribeToNeovimEvents`) back onto the document/selection.
 */
export function useNeovimCompartment({
  viewRef,
  neovimCompartment,
  isNeovimIntegrated,
  featureId,
  filePath,
  onModeChanged,
}: UseNeovimCompartmentArgs): void {
  useNeovimKeydownReconfigure(viewRef, neovimCompartment, isNeovimIntegrated, featureId, filePath);
  useNeovimEventSubscription(viewRef, isNeovimIntegrated, featureId, filePath, onModeChanged);
}
