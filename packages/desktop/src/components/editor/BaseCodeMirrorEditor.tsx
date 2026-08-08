import { useEffect, useRef, type RefObject } from "react";
import {
  EditorView,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
  keymap,
  tooltips,
} from "@codemirror/view";
import { EditorState, Compartment, type Extension } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { vim } from "@replit/codemirror-vim";
import { cadencrEditorTheme } from "./editor-theme";
import { ergonomicsExtensions } from "@/lib/editor/ergonomics-extensions";

interface BaseCodeMirrorEditorProps {
  /** Initial document content (only used on mount) */
  initialContent?: string;
  /** CodeMirror language extension (e.g. markdown(), getLanguageExtension()) */
  language?: Extension | null;
  /** Toggle read-only mode (hot-swappable) */
  readOnly?: boolean;
  /** Toggle vim mode (hot-swappable) */
  vimMode?: boolean;
  /**
   * Mount the editing-ergonomics extensions (code folding, auto-close brackets,
   * rectangular selection, selection-match highlight, fold/active-line gutter).
   * Read once at mount. Callers disable this in large-file mode to keep
   * multi-MB read-only buffers lightweight. Defaults to `true`.
   */
  ergonomics?: boolean;
  /** Called on every doc change — callers own debounce */
  onChange?: (value: string) => void;
  /** Mod-s handler */
  onSave?: () => void;
  /** Additional extensions (cursor tracking, etc.) */
  extraExtensions?: Extension[];
  className?: string;
  /** Escape hatch for direct EditorView access */
  editorViewRef?: React.MutableRefObject<EditorView | null>;
  onEditorViewChange?: (view: EditorView | null) => void;
}

function useCodeMirrorReconfiguration({
  viewRef,
  editorViewRef,
  vimCompartment,
  readOnlyCompartment,
  languageCompartment,
  vimMode,
  readOnly,
  language,
}: {
  viewRef: RefObject<EditorView | null>;
  editorViewRef?: React.MutableRefObject<EditorView | null>;
  vimCompartment: RefObject<Compartment>;
  readOnlyCompartment: RefObject<Compartment>;
  languageCompartment: RefObject<Compartment>;
  vimMode: boolean;
  readOnly: boolean;
  language?: Extension | null;
}): void {
  useEffect(() => {
    if (editorViewRef) editorViewRef.current = viewRef.current;
  });
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: vimCompartment.current.reconfigure(vimMode ? vim() : []) });
  }, [viewRef, vimCompartment, vimMode]);
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: readOnlyCompartment.current.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  }, [readOnly, readOnlyCompartment, viewRef]);
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: languageCompartment.current.reconfigure(language ?? []) });
  }, [language, languageCompartment, viewRef]);
}

function buildEditorExtensions({
  ergonomics,
  vimMode,
  readOnly,
  language,
  extraExtensions,
  onChangeRef,
  onSaveRef,
  vimCompartment,
  readOnlyCompartment,
  languageCompartment,
}: {
  ergonomics: boolean;
  vimMode: boolean;
  readOnly: boolean;
  language?: Extension | null;
  extraExtensions?: Extension[];
  onChangeRef: RefObject<((value: string) => void) | undefined>;
  onSaveRef: RefObject<(() => void) | undefined>;
  vimCompartment: RefObject<Compartment>;
  readOnlyCompartment: RefObject<Compartment>;
  languageCompartment: RefObject<Compartment>;
}): Extension[] {
  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged) onChangeRef.current?.(update.state.doc.toString());
  });
  const saveKeymap = keymap.of([
    {
      key: "Mod-s",
      run: () => {
        onSaveRef.current?.();
        return true;
      },
    },
  ]);
  return [
    history(),
    EditorState.allowMultipleSelections.of(true),
    tooltips({ parent: document.body }),
    drawSelection(),
    lineNumbers(),
    highlightActiveLine(),
    bracketMatching(),
    indentOnInput(),
    ergonomics ? ergonomicsExtensions : [],
    keymap.of([...defaultKeymap, ...historyKeymap]),
    saveKeymap,
    updateListener,
    vimCompartment.current.of(vimMode ? vim() : []),
    readOnlyCompartment.current.of(EditorState.readOnly.of(readOnly)),
    languageCompartment.current.of(language ?? []),
    ...cadencrEditorTheme,
    ...(extraExtensions ?? []),
  ];
}

export default function BaseCodeMirrorEditor({
  initialContent = "",
  language,
  readOnly = false,
  vimMode = false,
  ergonomics = true,
  onChange,
  onSave,
  extraExtensions,
  className = "h-full overflow-auto",
  editorViewRef,
  onEditorViewChange,
}: BaseCodeMirrorEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const vimCompartment = useRef(new Compartment());
  const readOnlyCompartment = useRef(new Compartment());
  const languageCompartment = useRef(new Compartment());

  // Store callbacks in refs to avoid stale closures
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  useCodeMirrorReconfiguration({
    viewRef,
    editorViewRef,
    vimCompartment,
    readOnlyCompartment,
    languageCompartment,
    vimMode,
    readOnly,
    language,
  });

  // Create editor once on mount
  useEffect(() => {
    if (!containerRef.current) return;
    const extensions = buildEditorExtensions({
      ergonomics,
      vimMode,
      readOnly,
      language,
      extraExtensions,
      onChangeRef,
      onSaveRef,
      vimCompartment,
      readOnlyCompartment,
      languageCompartment,
    });

    const state = EditorState.create({ doc: initialContent, extensions });
    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    if (editorViewRef) editorViewRef.current = view;
    onEditorViewChange?.(view);
    view.focus();

    return () => {
      view.destroy();
      viewRef.current = null;
      if (editorViewRef) editorViewRef.current = null;
      onEditorViewChange?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} className={className} />;
}
