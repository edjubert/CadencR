import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";
import type { TagStyle } from "@codemirror/language";
import { createTheme } from "@uiw/codemirror-themes";

const collapsedLinesIconMask =
  'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27black%27 stroke-width=%272.4%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Cpath d=%27m7 15 5 5 5-5%27/%3E%3Cpath d=%27m7 9 5-5 5 5%27/%3E%3C/svg%3E") center / contain no-repeat';

/**
 * CodeMirror theme. Driven entirely by CSS variables defined in `index.css`
 * under `:root[data-theme="<id>"]` blocks — switching the document's
 * `data-theme` attribute live re-skins every mounted editor without a
 * remount or compartment reconfigure.
 *
 * All Cadencr themes ship a dark code surface (Aurora keeps it dark on
 * purpose for legibility), so the CodeMirror `dark` flag is fixed to `true`.
 * If a future theme inverts that, replace this static extension with a
 * hook + compartment.
 */

export const editorHighlightStyles: TagStyle[] = [
  { tag: t.keyword, color: "var(--editor-pink)" },
  {
    tag: [t.name, t.deleted, t.character, t.macroName],
    color: "var(--editor-fg)",
  },
  { tag: t.propertyName, color: "var(--editor-cyan)" },
  { tag: [t.function(t.variableName), t.labelName], color: "var(--editor-green)" },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: "var(--editor-purple)" },
  { tag: [t.definition(t.name), t.separator], color: "var(--editor-fg)" },
  {
    tag: [
      t.typeName,
      t.className,
      t.number,
      t.changed,
      t.annotation,
      t.modifier,
      t.self,
      t.namespace,
    ],
    color: "var(--editor-cyan)",
  },
  {
    tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.link, t.special(t.string)],
    color: "var(--editor-pink)",
  },
  {
    tag: [t.meta, t.comment],
    color: "var(--editor-comment)",
    fontStyle: "italic",
  },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: "var(--editor-cyan)", textDecoration: "underline" },
  { tag: t.heading, fontWeight: "bold", color: "var(--editor-purple)" },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: "var(--editor-orange)" },
  { tag: [t.processingInstruction, t.string, t.inserted], color: "var(--editor-yellow)" },
  { tag: t.invalid, color: "var(--editor-red)" },
];

const cadencrTheme = createTheme({
  theme: "dark",
  settings: {
    background: "var(--editor-bg)",
    foreground: "var(--editor-fg)",
    caret: "var(--editor-cursor)",
    selection: "var(--editor-selection-bg)",
    selectionMatch: "var(--editor-selection-bg-soft)",
    lineHighlight: "var(--editor-line-highlight)",
    gutterBackground: "var(--editor-gutter-bg)",
    gutterForeground: "var(--editor-gutter-fg)",
    gutterBorder: "var(--editor-border)",
    // Shared with the git-diff so both code surfaces render identically — see
    // `--font-mono` / `--code-font-size` in index.css. rem-based size scales with
    // the mobile UI-zoom; neutral on desktop, where Electron's native zoom scales
    // the whole webview anyway.
    fontFamily: "var(--font-mono)",
    fontSize: "var(--code-font-size)",
  },
  styles: editorHighlightStyles,
});

/** Editor chrome that createTheme doesn't cover — height, panels, tooltip,
 *  autocomplete, matching brackets. CSS-var-driven so it tracks the theme. */
const cadencrChromeTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
    },
    ".cm-panels": {
      backgroundColor: "var(--editor-bg)",
      color: "var(--editor-fg)",
    },
    ".cm-foldPlaceholder": {
      backgroundColor: "transparent",
      border: "none",
      color: "var(--editor-comment)",
    },
    ".cm-tooltip": {
      // `color` matters on light themes (Aurora): without it, the base
      // `createTheme({ theme: "dark" })` setting leaks a white text color
      // into descendants, leaving lint diagnostic tooltips white-on-white.
      border: "1px solid var(--editor-border)",
      backgroundColor: "var(--editor-bg)",
      color: "var(--editor-fg)",
    },
    ".cm-tooltip .cm-tooltip-arrow:before": { borderTopColor: "var(--editor-border)" },
    ".cm-tooltip .cm-tooltip-arrow:after": { borderTopColor: "var(--editor-bg)" },
    ".cm-tooltip-autocomplete": {
      "& > ul > li[aria-selected]": {
        backgroundColor: "var(--editor-selection-bg)",
        color: "var(--editor-fg)",
      },
    },
    ".cm-matchingBracket": { color: "var(--editor-green)", fontWeight: "bold" },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 4px" },
    ".cm-buffer-search-match": {
      backgroundColor:
        "var(--editor-search-match-bg, color-mix(in srgb, var(--editor-yellow) 28%, transparent))",
      borderRadius: "2px",
      boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--editor-yellow) 55%, transparent)",
    },
    ".cm-buffer-search-match-active": {
      backgroundColor:
        "var(--editor-search-match-active-bg, color-mix(in srgb, var(--editor-orange) 60%, transparent))",
      boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--editor-orange) 100%, transparent)",
    },
  },
  { dark: true },
);

/** Diff/merge-specific theme — uses CSS-var-driven decoration colors. */
const cadencrDiffTheme = EditorView.theme(
  {
    ".cm-mergeView & .cm-deletedChunk": {
      backgroundColor: "var(--diff-del-bg)",
    },
    ".cm-mergeView & .cm-insertedLine": {
      backgroundColor: "var(--diff-add-bg)",
    },
    ".cm-mergeView & .cm-deletedLine": {
      backgroundColor: "var(--diff-del-bg)",
    },
    ".cm-mergeView & .cm-changedLine .cm-deletedText": {
      backgroundColor: "var(--diff-del-bg-strong)",
      textDecoration: "none",
    },
    ".cm-mergeView & .cm-changedLine .cm-insertedText": {
      backgroundColor: "var(--diff-add-bg-strong)",
      textDecoration: "none",
    },
    // Override CodeMirror's default 2px bottom gradient underline on changed text
    "&.cm-merge-b .cm-changedText, &.cm-merge-a .cm-changedText": {
      background: "none",
    },
    ".cm-mergeView & .cm-changeGutter": {
      width: "3px",
      paddingLeft: "0",
    },
    // "X unchanged lines" placeholder produced by `collapseUnchanged`. Without
    // an explicit rule, CodeMirror falls back to its base style (black bg /
    // white text) which ignores the active theme entirely.
    ".cm-mergeView & .cm-collapsedLines, & .cm-collapsedLines": {
      alignItems: "center",
      background: "var(--editor-selection-bg-soft)",
      color: "var(--editor-fg)",
      cursor: "pointer",
      display: "flex",
      fontSize: "12px",
      fontWeight: "600",
      gap: "8px",
      letterSpacing: "0.01em",
      lineHeight: "20px",
      borderTop: "1px solid var(--editor-border)",
      borderBottom: "1px solid var(--editor-border)",
      boxShadow:
        "inset 0 1px 0 color-mix(in srgb, var(--editor-fg) 8%, transparent), inset 0 -1px 0 color-mix(in srgb, var(--editor-bg) 30%, transparent)",
      padding: "5px 12px",
      transition: "color 120ms ease, box-shadow 120ms ease",
    },
    ".cm-mergeView & .cm-collapsedLines:hover, & .cm-collapsedLines:hover": {
      background: "var(--editor-selection-bg-soft)",
      boxShadow:
        "inset 0 1px 0 color-mix(in srgb, var(--editor-fg) 12%, transparent), inset 0 -1px 0 color-mix(in srgb, var(--editor-fg) 8%, transparent)",
      color: "var(--editor-fg)",
    },
    ".cm-mergeView & .cm-collapsedLines:before, & .cm-collapsedLines:before": {
      backgroundColor: "currentColor",
      content: '""',
      flex: "0 0 auto",
      height: "14px",
      marginInlineEnd: "0",
      mask: collapsedLinesIconMask,
      opacity: "0.9",
      width: "14px",
      WebkitMask: collapsedLinesIconMask,
    },
    // Merge controls (accept/reject buttons) — hidden in read-only mode
    ".cm-mergeView & .cm-merge-revert": {
      display: "none",
    },
    ".cm-mergeView": {
      height: "100%",
    },
    ".cm-mergeView .cm-mergeViewEditor": {
      height: "100%",
    },
  },
  { dark: true },
);

export const cadencrEditorTheme: Extension[] = [cadencrTheme, cadencrChromeTheme];

export const cadencrDiffExtensions: Extension[] = [
  cadencrTheme,
  cadencrChromeTheme,
  cadencrDiffTheme,
];
