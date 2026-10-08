---
# Cadencr Desktop — Design tokens and system definition
# Source of truth: Page - Unified agents.html
# Secondary: Page - Session.html (split-stacked layout reference only)

meta:
  project: Cadencr Desktop
  source_of_truth: Page - Unified agents.html
  secondary_reference: Page - Session.html
  default_theme: cadencr-dark
  default_screen: workspace        # Unified agents page lands on "unified"; Session lands on "workspace"

brand:
  direction: Emerald Reserve
  validated: 2026-07
  dark:
    ground: "#131416"
    rail: "#090A0C"
    raised: "#1A1B1D"
    foreground: "#EFF0F2"
    foreground_soft: "#A7A9AD"
    foreground_muted: "#6E7176"
    hairline: "#34373A"
    primary: "#2DB47D"
  light:
    ground: "#FAFAFB"
    rail: "#EFF0F2"
    raised: "#FFFFFF"
    foreground: "#222429"
    foreground_soft: "#60636A"
    foreground_muted: "#95989F"
    hairline: "#D7DADD"
    primary: "#087653"
  functional:
    dark: { file_change: "#8BCF67", edit_heading: "#F09A5B", deletion: "#EC707B", thinking: "#52BFD0", warning: "#E2B64D", generic_tool: "#6D9BEC", syntax: "#DE7CA7" }
    light: { file_change: "#3D7D14", edit_heading: "#A84F00", deletion: "#D12D49", thinking: "#007F9B", warning: "#966C00", generic_tool: "#1D5ED8", syntax: "#B52B70" }

themes:
  # CadencR Dark and Light are the product defaults. Aurora, Dracula, and
  # One Dark remain supported alternatives and keep their existing palettes.

  cadencr_dark:
    id: cadencr-dark
    label: CadencR Dark
    appearance: dark
    background: "#131416"
    surface: "#1A1B1D"
    surface_sunken: "#08090B"
    sidebar: "#090A0C"
    border: "#34373A"
    text_primary: "#EFF0F2"
    text_secondary: "#A7A9AD"
    text_muted: "#6E7176"
    accent: "#2DB47D"
    accent_thinking: "#52BFD0"
    accent_thinking_bg: "#1E272A"
    thinking_text: "#C1D2D5"
    edit_heading: "#F09A5B"
    success: "#8BCF67"
    danger: "#EC707B"
    warning: "#E2B64D"
    info: "#6D9BEC"
    syntax: "#DE7CA7"
    code_bg: "#08090B"
    code_fg: "#EFF0F2"
    user_message_bg: "#19231F"
    user_message_border: "#315447"

  cadencr_light:
    id: cadencr-light
    label: CadencR Light
    appearance: light
    background: "#FAFAFB"
    surface: "#FFFFFF"
    surface_sunken: "#F4F5F7"
    sidebar: "#EFF0F2"
    border: "#D7DADD"
    text_primary: "#222429"
    text_secondary: "#60636A"
    text_muted: "#95989F"
    accent: "#087653"
    accent_thinking: "#007F9B"
    accent_thinking_bg: "#F0F7F9"
    thinking_text: "#2F454B"
    edit_heading: "#A84F00"
    success: "#3D7D14"
    danger: "#D12D49"
    warning: "#966C00"
    info: "#1D5ED8"
    syntax: "#B52B70"
    code_bg: "#F4F5F7"
    code_fg: "#222429"
    user_message_bg: "#F1F6F3"
    user_message_border: "#A9C7BA"

  aurora:
    id: aurora
    label: Aurora
    appearance: light
    data_theme_key: light
    file: themes/aurora.json
    background: oklch(0.985 0.004 290)
    surface: oklch(1 0 0)                       # --card
    surface_elevated: oklch(0.965 0.008 290)    # sidebar / background-deep
    border: oklch(0.905 0.015 290)
    text_primary: oklch(0.205 0.040 285)
    text_secondary: oklch(0.32 0.040 285)       # --foreground-soft
    text_muted: oklch(0.46 0.040 285)
    accent: oklch(0.55 0.245 295)               # --primary (also --acc-purple)
    accent_violet: oklch(0.45 0.20 295)         # blocks.thinking-accent — for Thinking blocks ONLY
    accent_thinking_bg: oklch(0.96 0.04 295)
    success: oklch(0.58 0.18 150)               # --acc-green — ready dot, +diffs
    danger: oklch(0.58 0.22 25)                 # --acc-red — retry counter, -diffs
    warning: oklch(0.66 0.18 55)                # --acc-orange — "in progress" / dev pill
    info: oklch(0.58 0.13 220)                  # --acc-cyan — file refs
    code_bg: oklch(0.97 0.008 290)
    code_fg: oklch(0.205 0.04 285)

  dracula:
    id: dracula
    label: Dracula
    appearance: dark
    data_theme_key: dark
    file: themes/dracula.json
    background: oklch(0.22 0.022 277.497)
    surface: oklch(0.22 0.022 277.497)          # --card
    surface_elevated: oklch(0.23 0.022 277.497) # --sidebar
    border: oklch(0.32 0.032 277.821)
    text_primary: oklch(0.977 0.008 106.793)
    text_secondary: oklch(0.85 0.012 277.5)     # --foreground-soft
    text_muted: oklch(0.56 0.08 270.087)
    accent: oklch(0.742 0.149 301.871)          # #bd93f9 — Dracula purple
    accent_violet: "#dbb1ff"                    # blocks.thinking-accent
    accent_thinking_bg: "#1f1d31"
    success: "#50fa7b"
    danger: "#ff5555"
    warning: "#ffb86c"
    info: "#8be9fd"
    code_bg: "#1a1b26"
    code_fg: "#f8f8f2"
    dracula_pink: "#ff79c6"                     # mention chip identity in dark theme
    dracula_yellow: "#f1fa8c"
    dracula_comment: "#6272a4"

  one_dark:
    id: one-dark
    label: One Dark
    appearance: dark
    data_theme_key: onedark
    file: themes/one-dark.json
    background: oklch(0.27 0.014 257)           # ~#282c34
    surface: oklch(0.27 0.014 257)              # --card
    surface_elevated: oklch(0.25 0.012 257)     # --sidebar
    border: oklch(0.34 0.014 257)               # ~#3e4451
    text_primary: oklch(0.78 0.018 257)         # ~#abb2bf
    text_secondary: oklch(0.760 0.014 245)
    text_muted: oklch(0.58 0.018 257)           # ~#5c6370
    accent: oklch(0.72 0.13 240)                # #61afef — One Dark blue
    accent_violet: "#c678dd"                    # blocks.thinking-accent — One Dark magenta
    accent_thinking_bg: "#2a2533"
    success: "#98c379"
    danger: "#e06c75"
    warning: "#d19a66"
    info: "#56b6c2"
    code_bg: "#21252b"
    code_fg: "#abb2bf"

# ─── Typography ──────────────────────────────────────────────────────────
typography:
  families:
    brand:
      stack: '"Figtree Variable", "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
      role: Brand wordmark — the "CADENCR" logotype, rendered at weight 800 (see --font-brand)
    ui:
      stack: '"Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
      role: All UI text — sidebar, tabs, prompts, agent prose
    mono:
      stack: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
      role: Code blocks, terminal, diff gutters, file paths, tool-call bodies, +/- counters

  scale:
    h_section_user: { size: 22px, weight: 700, line_height: 1.25, letter_spacing: -0.01em, role: "Agent stream — user-section heading (.cds-section h3)" }
    h_section_agent: { size: 17px, weight: 700, role: "Agent stream — agent-section heading (.cds-section h3.green)" }
    body: { size: 14px, weight: 400, line_height: 1.55, role: "Default body — html/body" }
    body_stream: { size: 13.5px, line_height: 1.55, role: "Agent stream prose (.cds-stream)" }
    bubble: { size: 13px, line_height: 1.55, role: "User bubble (.cds-user-bubble)" }
    tab: { size: 12.5px, weight: 500, role: "Tab strip label" }
    feature_row: { size: 12.5px, role: "Sidebar feature row" }
    chip: { size: 11.5px, weight: 500, role: "Action-bar chip" }
    tool_call: { size: 11.5px, family: mono, role: ".cds-tool — collapsed tool-call row" }
    tool_term: { size: 11px, family: mono, line_height: 1.65, role: "Bash tool output" }
    diff: { size: 12px, family: mono, line_height: 1.7, role: "Diff body / code blocks" }
    git_diff: { size: 11.5px, family: mono, line_height: 1.65, role: "Git tab diff body" }
    editor: { size: 11.5px, family: mono, line_height: 1.7, role: "Editor pane code" }
    eyebrow: { size: 10px, weight: 700, transform: uppercase, letter_spacing: 0.12em, role: "Sidebar section labels (PROJECTS)" }
    meta_user: { size: 10.5px, family: mono, role: "User/agent timestamp meta" }
    context_bar: { size: 10.5px, family: mono, role: "Context % footer" }
    beta_badge: { size: 8px, weight: 700, transform: uppercase, role: "BETA/dev badge" }
    git_meta: { size: 11px, family: mono, role: "Branch + +/- counters in tab strip" }

# ─── Spacing scale (extracted from kit.css) ───────────────────────────────
spacing:
  # Most kit.css values cluster on these steps. New components MUST pick from this list.
  steps:
    - 0
    - 2px
    - 4px
    - 6px
    - 7px      # used for tab strip (padding 7px 14px) — reserved for tabs
    - 8px
    - 9px
    - 10px
    - 12px
    - 14px
    - 16px
    - 18px
    - 22px

  fixed_widths:
    sidebar: 268px
    pane_right_default: 380px
    pane_right_wide: 460px
    pane_right_stacked: 520px
    sidebar_header_height: 56px
    topbar_min_height: 52px
    explorer: 200px

# ─── Radii ────────────────────────────────────────────────────────────────
radii:
  base: 0.625rem        # --radius
  sm: 6px               # --radius-sm
  md: 8px               # --radius-md
  lg: 10px              # --radius-lg
  pill: 9999px          # status dots, traffic lights

# ─── Shadows ──────────────────────────────────────────────────────────────
shadows:
  pop_dark: "0 8px 30px rgba(0,0,0,.45), 0 2px 6px rgba(0,0,0,.25)"   # dracula
  pop_onedark: "0 8px 30px rgba(0,0,0,.40), 0 2px 6px rgba(0,0,0,.22)"
  pop_light: "0 12px 36px -10px oklch(0.50 0.20 295 / 0.22), 0 2px 8px -2px oklch(0.30 0.10 285 / 0.10)"
  card_subtle: "0 1px 2px rgba(0,0,0,0.06)"   # active button on theme switch

# ─── Transitions ──────────────────────────────────────────────────────────
transitions:
  fast: 120ms
  default: 150ms
  theme_swap: 220ms ease     # html/body background+color
  hover: 100ms
  easing_default: ease

# ─── Layouts ──────────────────────────────────────────────────────────────
layouts:
  single:
    grid_template_columns: "1fr"
    description: "All four tabs in the root pane. Default for Unified agents view; also fine for narrow viewports."
    used_by: Page - Unified agents.html
  split:
    grid_template_columns: "1fr 380px"
    description: "Root pane: agent + terminal · Right floating: git + editor"
  split-stacked:
    grid_template_columns: "1fr 520px"
    grid_template_rows_right: "1fr 1fr"
    description: "Root pane: agent solo · Right is vertically split — Terminal top, Git+Editor bottom. The canonical Session layout."
    used_by: Page - Session.html
  wide:
    grid_template_columns: "1fr 460px"
    description: "Root pane: agent solo · Right floating: git + editor + terminal in one tab strip"

# ─── Status palette (RESERVED — never reuse for decoration) ───────────────
status:
  ready: success           # green dot in worktree row, agent feat-title dot
  in_progress: warning     # orange — feature row "in progress" pill
  retry: danger            # red — retry counter on prompt action bar
  thinking: accent_violet  # legacy schema name; resolves to the theme-owned thinking accent

# ─── Iconography ─────────────────────────────────────────────────────────
iconography:
  library: Lucide-style hand-rolled SVGs in icons.jsx
  stroke_width: 2
  default_size: 14
  small: 13
  micro: 10..12
  fill: none (stroke-only)
  rule: All glyphs use currentColor — never hard-code stroke/fill in the icon component
---

# Cadencr Desktop — Design System

## Brief

**What it is.** Cadencr Desktop is the developer-facing control surface for managing autonomous coding agents across multiple projects and worktrees. It is a single-window, four-pane workspace that lets a human supervise an agent's reasoning (Agent), watch it execute (Terminal), inspect what changed (Git), and verify or make focused corrections to the result (Editor) — all from one screen, without context-switching.

**Who it's for.** Senior individual contributors and tech leads who run multiple parallel agent sessions and need to scrub through reasoning, terminal output, and diffs faster than a chat thread allows. The product assumes the user reads code, knows what a worktree is, and prefers keyboard-driven dense IDEs over chat-style UIs.

**What it is NOT.** It is not a chat app — the agent stream is a transcript artifact, not a conversation surface. It is not a general-purpose code authoring IDE: the Editor remains review-first, while permitting focused file edits and conflict resolution when verification reveals work to correct. It is not a generic AI sidebar; it is the primary workspace.

## Brand identity (validated 2026-07 — "Emerald Reserve")

The brand direction was re-validated in July 2026 through the in-product palette exploration in `packages/landing/palette-exploration.html` and Raphael's iterative review. The landing leads and the `cadencr-dark` / `cadencr-light` defaults follow the same handoff tokens. Legacy themes keep their own identities.

- **Logo — "Index Dots".** Twelve ink dots (r1.9) on a r14.5 ring around a solid emerald core (r5.5), on a 48 grid. Distilled from the original dotted-ring favicon; two colors only. Favicon / ≤32px raster cut: dots r3, core r7. Core color: emerald `#2DB47D` on dark grounds, emerald-deep `#087653` on light. Dots always take the surrounding ink color (`currentColor`). The old multi-color agent arcs are retired. These values live in code in `packages/brand` — edit them there and run `pnpm brand:install` rather than hand-editing any icon.
- **Wordmark.** `CADENCR` in Figtree, weight 800, uppercase, tracked ~0.05em — unchanged (`--font-brand` already renders this).
- **Dark handoff.** Ground `#131416`, darker rail `#090A0C`, Raised `#1A1B1D`, Ink `#EFF0F2`, Soft `#A7A9AD`, Muted `#6E7176`, Hairline `#34373A`, Emerald `#2DB47D` (primary). Neutral surfaces carry no visible green cast; the primary supplies life.
- **Light handoff.** Ground `#FAFAFB`, darker rail `#EFF0F2`, Raised `#FFFFFF`, Ink `#222429`, Soft `#60636A`, Muted `#95989F`, Hairline `#D7DADD`, Emerald Deep `#087653` (primary). Light-mode functional colors are deliberately deeper and more vibrant than muted pastel tints.
- **Functional handoff.** Tool colors are semantic and independent of primary: file-change counters and diff status stay green `#8BCF67` / `#3D7D14`, while `Edit` / `Write` / `ApplyPatch` headings use copper `#F09A5B` / `#A84F00`; deletion `#EC707B` / `#D12D49`, thinking `#52BFD0` / `#007F9B`, warning `#E2B64D` / `#966C00`, generic tool `#6D9BEC` / `#1D5ED8`, syntax `#DE7CA7` / `#B52B70` (dark / light). Bash remains terminal-neutral. Thinking supporting text is `#C1D2D5` / `#2F454B`. Model and permission-mode controls retain their established violet/fuchsia/blue identities through `--chip-*`; they do not inherit brand emerald.
- **Landing typography** (not a desktop mandate): Schibsted Grotesk for display/body, JetBrains Mono for annotations. Desktop UI stays Inter until the new theme work decides otherwise.

Full spec: `packages/landing/DESIGN.md`.

## Theme philosophy

Cadencr ships with two brand defaults — **CadencR Dark** and **CadencR Light** — plus the established **Aurora**, **Dracula**, and **One Dark** alternatives. The brand pair owns first paint and system-follow behavior; alternatives remain opt-in and retain their existing palettes. Every additional theme expands the QA matrix and requires a complete semantic, editor, diff, and xterm palette.

**Composition model.** A theme is a `data-theme="..."` attribute on `<html>` backed by a `ThemeDefinition` in `packages/desktop/src/lib/themes/`. CSS owns the semantic UI contract; the TypeScript definition owns metadata, the picker swatch, the logo cut, and the complete xterm palette. `theme-cadencr.css` binds the brand pair, while the existing legacy theme selectors remain independent. A missing CSS token falls through to the shared default — never null.

**Resolution.** Theme ids are explicit and provider-neutral. Registration and system-follow resolution live in `src/lib/themes/registry.ts` and `src/lib/themes/system.ts`:

```
cadencr-dark  → CadencR Dark (default dark and first paint)
cadencr-light → CadencR Light (default system-follow light)
aurora        → Aurora
dracula       → Dracula
one-dark      → One Dark
```

**Chrome — the shape of a theme, not its palette.** Three structural traits travel with a theme as data (`chrome` in `theme.json`; `ThemeDefinition.chrome` for a built-in), because a theme duplicated from another one has to *look* like it and not just be colored like it:

| Trait | Values | What it decides |
|---|---|---|
| `chassis` | `flat` · `rail` | Whether the page tucks into the sidebar rail as a raised card with a rounded top-left corner, sharing one continuous header band (CadencR pair), or sits full-bleed under its own header (everything else). Desktop only — below 768px every theme is flat. |
| `tabs` | `underline` · `segmented` | Whether the active pane tab is a hairline indicator or a raised pill in a recessed track. |
| `texture` | layers | What is painted behind the app: a flat `base`, drifting blurred `halos`, an `image` from the theme's own folder, generated `grain`, and a `veil` that washes the field back down with `--background` so surfaces stay legible. The Frost pair is one instance of this vocabulary, not a special case. |

`applyThemeToDocument` publishes the first two as `<html data-chassis data-tabs>`; the texture is rendered by `<AmbientBackground/>` and laid out by `theme-chrome.css`, which must never contain a `data-theme` selector. A texture that declares a `base` also makes `:root` opaque and `body` transparent — required for `backdrop-filter` to paint at all.

The CadencR pair's *material* (pane elevation, lamplight, machined wells, prompt chrome) stays theme-scoped in `theme-cadencr-material.css`: it depends on tokens only those themes declare, and it is a look rather than a structural choice.

**Chrome has colors, and they belong to the theme.** The token vocabulary has two tiers. The required set is the palette every theme defines in full; a short optional set — `--tab-track-bg`, `--tab-track-border`, `--tab-active-bg`, `--pane-border` — colors the shapes a theme opted into, and `theme-chrome.css` derives a fallback from `--foreground`/`--background` for any a theme leaves out. They are optional because most themes draw neither shape; they exist because without them the only way to recolor a segmented tab strip was to edit the app's shared stylesheet — a change no installed Cadencr can receive, applied to every theme at once. An unknown key is still an error: this widens the vocabulary, it does not open it. `--tab-active-shadow` and `--page-shadow` stay out, being `box-shadow` values rather than colors. Duplication carries whichever of them the source theme declares, which is how a copy of CadencR Dark keeps its tab colors and not just its tab *shape*.

**A theme folder explains itself, and answers back.** A user theme is edited in its own project, which in practice means an agent with `theme.json` open and nothing else to go on — and the document is self-describing for colors and opaque for chrome. Worse, the verdict on what it writes lands on a settings card it cannot see, so a theme could be declared finished while the app quietly refused to apply it. Four files beside `theme.json` close that loop:

| File | For |
|---|---|
| `THEME.md` | The loop, the vocabulary, the bounds, and what a rejected file does. Leads with the check command. |
| `theme.schema.json` | The machine-checkable half; the document's own `$schema` points at it, so an editor completes and flags as you type. |
| `check-theme` | Runs `cadencr-service check-theme` on this folder: the app's gate, on demand. Prints the settings card's own wording, exits non-zero when the theme is not applicable. |
| `AGENTS.md` / `CLAUDE.md` | The boundary, in the files an agent loads before its first instruction: this folder is the whole theme, never edit the app's source, run the check, and *say so and stop* when a request isn't expressible here. |

All of them are written on every open and excluded from the theme's git via `.git/info/exclude` — the schema generated from the same constants `validate` enforces, the prose held to them by tests — they are the app's, not the theme's. The command is deliberately not a second implementation: it calls `store::read_at`, the same function the gallery calls, so the two can never disagree. It needs no server, database or token, and the launcher is rewritten each open so its path follows the binary across rebuilds and updates.

Chrome additionally denies unknown fields, so a misspelled key is a reported issue rather than a silent default; the label is recovered from the raw JSON when the document won't deserialize, so that costs a message and not the theme's name. Bounds, variant lists and the reference's prose are guarded against drift by tests in `themes/schema.rs` and `themes/scaffold.rs`; a new chrome value belongs in `ThemeChassis::ALL`-style lists and in `THEME.md`, or those tests fail.

**Adding a theme.**
1. Add a complete typed `ThemeDefinition` under `src/lib/themes/`, including a full xterm palette and stable swatch.
2. Add the theme's semantic CSS selector without changing another theme's tokens.
3. Register it in `registry.ts`; the picker is registry-driven and must not hardcode a second list.
4. Extend registry and scrollbar contract tests, then verify editor, terminal, agent tools, diffs, onboarding, and system-follow behavior in the running app.

## Layout decision logic

The pane configuration is a single `tweaks.layout` value with four legal states. Every layout MUST be registered in (a) the `config` `useMemo` in the HTML file's `App` component, (b) the `cds-split` CSS rules in `kit.css`, and (c) the `TweakRadio` options in the Tweaks panel. A layout that is not in all three places is broken.

| Layout | When to use | Default for |
|---|---|---|
| `single` | All four tabs in one pane. Use when the viewport is narrow, when the user is reviewing one thing at a time, or as a fallback. | Unified agents (the cards already show many agents — no need for split panes inside a card). |
| `split` | Two equal-priority surfaces — agent reasoning + one inspection pane. The classic IDE feel. | Generic "I'm doing one feature" sessions. |
| `split-stacked` | Agent gets the full left column. Right column is vertically split — Terminal top, Git+Editor bottom. Use when terminal output and the diff are both running hot and the user wants to glance at both without tabbing. | **Session view (`Page - Session.html`).** |
| `wide` | Agent solo on the left, every other tool stacked into one tabbed pane on the right. Use for narrow secondary monitors or when the agent narrative is the main content. | One-off; not a default. |

**Session vs Unified agents.** Unified agents lands on `screen="unified"` and renders `<UnifiedAgentsView>` — a grid of agent cards. Session lands on `screen="workspace"` and renders the four-pane workspace. They share the same React component tree below the screen switch; the screen value is the only routing concept.

## Component anatomy

### AgentPanel (`<window.Panels.AgentPanel/>`)

The agent stream. A vertical scroll of mixed content: user bubbles, agent prose, code blocks, tool calls, thinking blocks. **This is the most important surface in the product** — every other pane is in service of what's happening here.

- **Structure:** `.cds-stream > [meta, bubble | section | tool, ...]` in document order.
- **States:** Tool calls have collapsed (single-line button) and open (expanded with diff/term body) states. The collapsed `.cds-tool` is a `<button>`; the open one is a `<div>`.
- **Tokens consumed:** `--background`, `--foreground`, `--primary-glow` (user bubble), `--ic-bg`/`--ic-fg` (mention chips), `--ic-file-bg`/`--ic-file-fg` (file refs), `--code-bg`/`--code-fg` (code blocks), `--diff-add-bg`/`--diff-del-bg`, `--tag-grep`/`--tag-read`/`--tag-bash`/`--tag-edit`/`--tag-think`, `--h-user`/`--h-agent` (section headings).
- **When to use vs alternative:** This is the only place agent reasoning surfaces. Do not duplicate.

#### Thinking block (sub-component)

A collapsible card with a theme-owned thinking tint distinct from the surrounding stream. The dedicated tint is the affordance — it tells the user "this is meta-reasoning, not output." Use `--block-thinking-accent` and `--block-thinking-bg`; in Emerald Reserve these are cyan, with separate supporting text chosen for contrast. **Never use `--primary` for a thinking block:** reasoning has its own semantic slot, separate from primary-action color.

#### MCP tool call

Same chrome as a regular tool call (`.cds-tool`) but the `.tag` element gets a colored prefix indicating provider. Body is monospace, file paths in cyan (`--ic-file-fg`), counts in `--acc-green`/`--acc-red`. Bash variant gets terminal-style chrome (`.cds-tool.open.bash`) via its own `--block-bash-header-bg` / `--block-bash-body-bg` / `--block-bash-fg` / `--block-bash-muted-fg` tokens, which follow the theme (dark on Dracula, light on Aurora). The live xterm still stays dark in every theme — see rule 10.

### TerminalPanel (`<window.Panels.TerminalPanel/>`)

Static terminal-style log. Always uses `--code-bg` and `--code-fg` regardless of theme — even Aurora's terminal stays dark. This is intentional: a terminal that flips to white-bg looks broken to developers.

- **Structure:** `.cds-terminal > div.line[.kind]`. Kinds: `cmd`, `ok`, `info`, `mod`, `add`, plain.
- **States:** Static. No interactive states.
- **Tokens:** `--code-bg`, `--code-fg`, `--acc-green` (ok), `--acc-yellow` (info/warn), `--acc-cyan` (urls + branch).

### GitPanel (`<window.Panels.GitPanel/>`)

Three rows: head (file path + +/- stats + Viewed checkbox), body (diff hunks), foot (file count + view mode toggle).

- **Structure:** `.cds-git > [.cds-git-head, .cds-git-body, .cds-git-foot]`.
- **States:** Body rows are `.add` / `.del` / `.unchanged` / `.ctx`. Foot toggle is Unified (default) or Split.
- **Tokens:** `--diff-add-bg`, `--diff-del-bg`, `--code-bg`, `--code-fg`, `--acc-green`/`--acc-red` for stats.

### EditorPanel (`<window.Panels.EditorPanel/>`)

Review-first two-column grid: 200px file explorer + writable code area with tab strip and footer. The Editor supports focused edits, including resolving Git conflict markers, through the existing save/auto-save and formatting flows. It is not the primary surface for broad code authoring. Syntax tokens (`tok-kw`, `tok-str`, `tok-type`, `tok-prop`, `tok-comment`, `tok-num`, etc.) map to `--acc-*` accents.

- **States:** Explorer item active/dim. Editor tab active. Ordinary large files begin behind the existing `Edit anyway` safety gate before becoming writable.
- **Tokens:** `--code-bg`, `--code-fg`, `--primary` (active explorer item via 28% mix), `--acc-pink`/`--acc-cyan`/`--acc-green`/`--acc-yellow` for syntax.
- **When to use vs alternative:** Use Editor to inspect agent output, make a bounded correction, or resolve a conflict in the current worktree. Keep broad implementation work in the agent workflow or the user's dedicated external editor so Cadencr's product posture stays review-first.

#### Conflict resolver

The conflict resolver is an Editor mode for one unmerged worktree path. It reuses the existing tab, theme, dirty-buffer behavior, Save ownership, auto-save/Mod+S, and review-first posture rather than creating a separate editor surface. It must read as a **native CodeMirror file edit, not a bespoke conflict dashboard**.

##### Activation and anatomy

- Opening a path that backend-confirmed Git status reports as an exact unmerged file activates the resolver automatically — there is no "Resolve in Editor" step. Watcher-confirmed resolution returns a clean tab to the ordinary editor. A dirty Result keeps only a small exact-path latch in its pane, so switching to another tab and back cannot replace unsaved conflict edits after status clears; the latch disappears when that path is no longer dirty. Ordinary files open normally, and no Git state is mirrored into editor tabs.
- No resolver header, footer, or comparison toolbar. There is exactly **one writable `Result` `EditorView`**; conflict regions and per-hunk actions live inline in CodeMirror. The Result is the whole surface — the tab strip already names the file.
- The existing file-content endpoint supplies the worktree Result plus binary, large-file, and missing-content metadata. The resolver parses literal Git marker blocks directly from those Result bytes; it does not request Base/stage documents or a presentation/fingerprint contract.
- Current vs Incoming marker regions are rendered as color-coded inline decorations (theme-owned cyan for Current and violet for Incoming, distinct from the reserved add/green and delete/red diff colors). A diff3 `|||||||` Base section, when present in the Result, receives a muted inline decoration but is not a separate document or accept source. There is no source-comparison picker, self-comparison view, or CodeMirror merge extension.

Operation-aware marker labels drive the inline accept actions (never generic Current/Incoming during rebase):

| Result marker side             | Merge label     | Rebase label    | No operation context |
| ------------------------------ | --------------- | --------------- | -------------------- |
| Current (`<<<<<<<` to divider) | Current branch  | Rebased result  | Index stage 2        |
| Incoming (after `=======`)     | Incoming branch | Replayed commit | Index stage 3        |

Supported text hunks offer `Accept Current branch` and `Accept Incoming branch` during merge, `Accept Rebased result` and `Accept Replayed commit` during rebase, plus `Accept both`. They edit only `Result` as one undoable transaction, dirty the buffer, and never Save or Stage immediately. `Accept both` applies stage 2 before stage 3. If a hunk no longer maps safely after manual edits, its action row is replaced inline by a short reason and manual editing is preserved rather than guessing.

##### States and actions

- Binary, both-deleted, unsupported, unavailable, and deleted worktree Results use explicit guidance instead of fabricated empty source panes. Confirmed deletion conflict kinds offer `Stage deletion`; other unavailable Results require repository inspection before staging. Large text Results use the same one-buffer marker resolver: the single-file fetch already returns the explicitly opened content, and the resolver runs no source-comparison diff.
- Save writes only `Result` bytes to the worktree and continues to show that staging is required. Stage is explicit, and the conflict UI remains until watcher-confirmed status removes the unmerged path.
- The per-file Git banner owns explicit `Stage` and watcher-confirmed resolution; the operation-wide banner owns Continue and Abort, and Continue stays disabled until every conflict is staged. It is state-aware: while conflicts remain it wears the warm `--acc-orange` "paused on conflicts" identity, and once every conflict is staged it flips to the `--acc-green` "ready to continue" identity with Continue enabled — the two accents follow the documented in-progress/ready status semantics. Continue and Abort read as the operation Git itself is running (`Continue merge`/`Abort rebase`), never the internal "update" wording. The per-file banners stay visually subordinate to this one command bar — a quiet accent stripe rather than a stack of repeated alarm bands.
- Loading, failures, and actions have visible progress or error states. Action groups are keyboard reachable with clear focus, disabled actions explain why, and updates use one polite status region.
- The resolver is for bounded review and conflict resolution, not general three-way authoring.

### Sidebar (`<window.Sidebar/>`)

268px fixed-width left rail. Header (traffic lights + brand + dev pill) → All-agents nav button → Projects scroll area → Settings footer.

- **Structure:** `.cds-sidebar > [.cds-sidebar-header, .cds-sidebar-nav, .cds-sidebar-scroll, .cds-sidebar-footer]`.
- **Project group:** `.cds-project-group > [.cds-project-row, .cds-feature-list]`. The feature list has a left rail (`border-left: 1px solid var(--sidebar-border)`).
- **Active feature:** `.cds-feature-row.active` gets a `--primary` 18% mix bg + a `.cds-active-rail` 2px primary bar at left:-11px.
- **Worktree group:** conversations sharing one worktree are banded into `.worktree-group` — a `--sidebar-border` rim plus a 5% `--sidebar-foreground` wash. This is the one sidebar surface that does *not* take the neutral `--accent` wash: `--accent` is spoken for by row hover, and a group must never read as a hovered or selected row. The rim carries the grouping; the fill stays below the hover tint. Palette tokens are unusable here — `--muted` equals `--sidebar` in CadencR Light.
- **Conversation row:** a stable 24px title line (including hover/focus), a fixed 14px leading status slot, optional worktree marker, truncating title, then a 16px identity/shortcut slot at the far right of the first line. Metadata stays below; pin/archive actions appear on hover, keyboard focus, or touch devices instead of reserving empty columns.
- **Provider mark:** always a quiet mono silhouette, never animated or status-tinted. Normalize bundled marks to a 14px longest ink edge, compensating for transparent canvas padding in provider metadata. Settings → Interface & Zoom → Show provider logos hides branding only. Holding Command (macOS) or Control (Windows/Linux) replaces the mark with the numeric navigation hint in the same slot.
- **Conversation status:** distinguish activity from a finished, unread response by both shape and color: a blue rotating 12px open ring while working, a steady green 14px check for unread messages once idle, an amber permission shield, a primary question glyph, and a muted idle dot once read. Pending indicators retain the existing interactive gate popover. Reduced motion and disabled animations stop rotation; the open ring remains distinct from the check. A check means a response is ready to read, not that its task or tests succeeded.
- **Tokens:** `--sidebar`, `--sidebar-border`, `--accent` (hover bg), `--primary` (question/active), `--muted-foreground` (eyebrows, idle, mono marks), `--sidebar-foreground` (text + worktree-group wash). Sidebar working retains Tailwind `blue-500`; finished/unread uses `--acc-green` (ready); permission retains `amber-400`.
- **When to use vs alternative:** The sidebar is global navigation. Per-pane navigation goes in the tab strip, not here.

### TopBar

52px-min-height bar above the split. Owns the feature title, the theme switcher, the new-action button, and the settings gear.

- **Structure:** `.cds-topbar > [.feat-title, .cds-top-actions]`.
- **Tokens:** `--background`, `--border`.

### PromptBar

The agent input. Lives in the root pane only — never duplicate it in a floating pane.

- **Structure:** `.cds-prompt-wrap > .cds-prompt-bar > [textarea, .cds-prompt-actions]` followed by `.cds-context-bar`.
- **States:** Default (muted bg, transparent border) → focus-within (card bg, primary border, primary-glow ring). Send button disables when textarea is empty.
- **Tokens:** `--muted` (default bg), `--card` (focus bg), `--primary` (focused border + send button bg), `--primary-glow` (focus ring), `--on-primary` (send icon).

### ActionBar

Five chips above the prompt: Auto-scroll · Autonomy · Model · Thinking effort · Errors. The error chip is `success`-styled when count is 0, `danger` when nonzero.

- **States:** chip default, chip.on (toggled), chip.success/warn/primary/ghost.
- **Tokens:** `--border`, `--accent` (hover), `--chip-violet-*` (model and Auto-Accept controls), `--primary`/`--primary-glow` (.on), `--acc-green`/`--acc-orange` (status chip variants).

### Worktree row

A single-line indicator above the tab strip in Session/workspace view: branch icon + worktree path + clipboard chip + ready dot. Sits between TopBar and the pane tabs. Uses `success` for the ready state — never warm-orange or accent.

### Status dot

A 7–9px circle with a 2–3px halo (`box-shadow` 0 0 0 spread). Three legal slots:
- `--status-ip` (success/green) — feature in flight, "ready" worktree
- `--acc-orange` — "in progress" annotation
- `--acc-pink` (Dracula) — secondary project marker

The dot's color is the meaning. Do not introduce a fourth color without registering it as a status token.

## Iconography & status colors

- **Green dot** = ready (worktree set up, agent connected). Bound to `--status-ip` / `success`.
- **Theme-owned thinking tint** = thinking (agent meta-reasoning). Bound to `--block-thinking-accent` / `--block-thinking-bg`, never raw `--primary`.
- **Red counter** = retry / errors / -diff. Bound to `danger` / `--acc-red`.
- **Orange chip** = "in progress" / dev-pill. Bound to `warning` / `--acc-orange`.
- **Cyan path** = file reference. Bound to `info` / `--acc-cyan` (`--ic-file-fg`).
- **Pink chip** = mention / `@thing`. Bound to `--ic-fg` (`--acc-pink` in Dracula).
- **Yellow chip** = checks green, humans still waiting (a proposal whose CI reports passing and whose review threads are unresolved). Bound to `--acc-yellow`. Distinct from the orange "in progress" chip on purpose: nothing is running or failing, the ball is in the author's court. A repo with no CI at all keeps its check-driven chip — the count is only looked up for a reported pass, so "no checks" stays neutral rather than yellow.

**Semantic colors are token-owned.** Do not infer meaning from hue alone. Emerald Reserve intentionally uses green for brand primary while file changes use a distinct leaf green; components must consume `--primary`, `--acc-green`, `--acc-red`, and the block tokens by role. A non-semantic surface uses the neutral `--accent` wash, not a copied hex.

## Don'ts

1. **No fonts other than Inter, JetBrains Mono, and Figtree (brand wordmark only).** Do not import Roboto, system-ui first, Fraunces, or Arial. The font stacks in `themes.css` are the only legal stacks. Figtree is the one registered third face — it is reserved for the `CADENCR` wordmark (`--font-brand`, weight 800) and must not be used for UI or body text. If a further face is needed, add it here with a clear role.
2. **No hardcoded hex in JSX.** Every color in a component file goes through a `var(--...)` lookup. Inline `style={{ color: "#..." }}` is forbidden except for placeholder squares in fixtures (and even those should be CSS classes).
3. **No purple gradients on white.** Aurora is light but not whimsical. Solid colors only; the only gradients in the system are the `--primary-glow` color-mix effects on focus/hover.
4. **No new spacing values outside the kit.css scale.** If you need 11px, you actually need 10 or 12. If you need 13px, use 12 or 14. Pick the closest step.
5. **Thinking blocks always use the thinking block tokens, never `accent` or `primary`.** The contract is semantic separation even when a legacy theme makes two roles look similar.
6. **No CSS-in-JS.** All styling lives in `kit.css` and `themes.css`. JSX may reference CSS variables inline (`style={{ background: "var(--acc-green)" }}` is fine for a one-off swatch), but no `styled-components`-style libraries, no inline rule sets larger than ~3 declarations, and no class-name generators.
7. **No new layout without registering it in all three places** — `config` useMemo, `kit.css` `cds-split` rules, and the `TweakRadio` options. A layout that exists in two of the three is a bug.
8. **Brand and status greens never share a token.** The logo and primary actions use `--primary`; ready and added states use their semantic tokens. Emerald branding must never make a neutral control look successful.
9. **The `--code-bg` / `--code-fg` surface stays dark even in Aurora.** Markdown code blocks and editor-adjacent code surfaces are intentionally Dracula-like in the light theme — a white code block looks washed-out and breaks the dev-tool convention. The bash tool-call block is the one carve-out: it follows the theme via `--block-bash-*` (see "Bash variant").
10. **Live terminal (xterm/PTY) never inverts.** Always uses `--code-bg` and stays dark regardless of theme. Future theme JSONs MUST keep `terminal.bg` dark.
11. **No new screen-level routes without a `data-screen-label`.** Every full-pane screen must set `data-screen-label="NN Title"` (1-indexed) on the `.cds-app` so review comments can pin to it.
12. **No prompt bar outside the root pane.** It lives once, in the non-floating root pane. Floating panes never own input.
13. **No untranslated tweak.** Every value in `TWEAK_DEFAULTS` must round-trip through the Tweaks panel — i.e. there is a `Tweak*` control bound to it. No "secret" tweaks.

## Self-audit (sample screens)

**Settings panel.** Already covered — uses `--card`, `--border`, `--muted`, sidebar tokens for nav, primary for active row. No new tokens needed; the page goes through `screen="settings"` and renders `<window.SettingsPage>`. ✓

**Empty-state for the agent stream.** Tokens needed:
- `--muted-foreground` for the prose
- `--accent` for the "What can I help with?" affordance background
- An icon at 32px stroke-2 (extension of the `iconography.scale` — added "xl: 32" implicitly; explicitly noted that empty states may use `28–40px` icons, the only place above 22).

**Error toast.** Needed tokens:
- `--acc-red` (border + accent strip)
- `--card` (toast surface)
- `--shadow-pop` (lift)
- 4–6s auto-dismiss falls under `transitions` but isn't currently a token. **Added constraint:** ephemeral overlay durations (toast, tooltip auto-hide) use `transitions.toast: 4000ms`. Add this if/when toasts ship — until then, do not invent a duration.

**Audit conclusion.** The token coverage is complete for current surfaces. Two implicit constraints surfaced and are now explicit in the YAML/Don'ts: code surfaces stay dark across themes (rule 9), and large empty-state icons are the only legal exception to the icon size cap.
