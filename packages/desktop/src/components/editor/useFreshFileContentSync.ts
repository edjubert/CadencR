import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Text, Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

interface FreshFileContentSyncOptions {
  content: string | undefined;
  viewRef: RefObject<EditorView | null>;
  onDirtyChange: (dirty: boolean) => void;
}

// Match CodeMirror's line-ending normalization without flattening live documents.
function diskDocument(content: string): Text {
  return Text.of(content.split(/\r\n?|\n/));
}

export function useFreshFileContentSync({
  content,
  viewRef,
  onDirtyChange,
}: FreshFileContentSyncOptions) {
  const baseline = useRef<Text | null>(null);
  const disk = useRef<Text | null>(null);
  const applying = useRef(false);
  const dirtyRef = useRef(false);
  const conflictRef = useRef(false);
  const [diskChanged, setDiskChanged] = useState(false);
  const onDirtyRef = useRef(onDirtyChange);
  onDirtyRef.current = onDirtyChange;

  const reconcile = useCallback((doc: Text): boolean => {
    const dirty = disk.current !== null && !doc.eq(disk.current);
    if (!dirty && disk.current) {
      // Reuse the live persistent tree so later edits compare only changed branches.
      baseline.current = doc;
      disk.current = doc;
    }
    const conflict =
      dirty &&
      baseline.current !== null &&
      disk.current !== null &&
      !baseline.current.eq(disk.current);
    if (conflictRef.current !== conflict) {
      conflictRef.current = conflict;
      setDiskChanged(conflict);
    }
    if (dirtyRef.current !== dirty) {
      dirtyRef.current = dirty;
      onDirtyRef.current(dirty);
    }
    return dirty;
  }, []);

  const applyDisk = useCallback(
    (view: EditorView, next: Text) => {
      baseline.current = next;
      disk.current = next;
      applying.current = true;
      try {
        if (!view.state.doc.eq(next)) {
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: next },
            selection: { anchor: Math.min(view.state.selection.main.head, next.length) },
            annotations: Transaction.addToHistory.of(false),
          });
        }
      } finally {
        applying.current = false;
      }
      reconcile(view.state.doc);
    },
    [reconcile],
  );

  useEffect(() => {
    if (content === undefined) return;
    const next = diskDocument(content);
    const previousDisk = disk.current;
    disk.current = next;
    const view = viewRef.current;
    if (baseline.current === null) {
      baseline.current = next;
    } else if (view && previousDisk && view.state.doc.eq(previousDisk)) {
      // Only a buffer that still equals the last observed disk may follow it.
      applyDisk(view, next);
      return;
    }
    if (view) reconcile(view.state.doc);
  }, [content, viewRef, applyDisk, reconcile]);

  const onDocChange = useCallback(
    (doc: Text): boolean => {
      const dirty = reconcile(doc);
      return dirty && !applying.current;
    },
    [reconcile],
  );

  const markSaved = useCallback(
    (doc: Text) => {
      baseline.current = doc;
      disk.current = doc;
      const view = viewRef.current;
      if (view) reconcile(view.state.doc);
    },
    [reconcile, viewRef],
  );

  const reload = useCallback(
    (content: string) => {
      const view = viewRef.current;
      if (view) applyDisk(view, diskDocument(content));
    },
    [applyDisk, viewRef],
  );

  return useMemo(
    () => ({ diskChanged, conflictRef, dirtyRef, onDocChange, markSaved, reload }),
    [diskChanged, onDocChange, markSaved, reload],
  );
}
