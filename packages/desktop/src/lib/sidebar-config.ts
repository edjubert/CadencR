import { z } from "zod";

/**
 * Sidebar display options: one typed workspace setting per option. The value
 * sets mirror the Rust validators in
 * `packages/service/src/domain/settings_store/registry/sidebar.rs`.
 */

interface EnumOption<V extends string> {
  kind: "enum";
  key: string;
  schema: z.ZodType<V>;
  fallback: V;
}

interface BoolOption {
  kind: "bool";
  key: string;
  fallback: boolean;
}

type SidebarOption = EnumOption<string> | BoolOption;

function enumOption<const V extends string>(
  key: string,
  values: readonly [V, ...V[]],
  fallback: NoInfer<V>,
): EnumOption<V> {
  return { kind: "enum", key, schema: z.enum(values), fallback };
}

function boolOption(key: string, fallback: boolean): BoolOption {
  return { kind: "bool", key, fallback };
}

export const SIDEBAR_OPTIONS = {
  density: enumOption("sidebar_density", ["compact", "comfortable", "spacious"], "comfortable"),
  fontSize: enumOption("sidebar_font_size", ["12", "12.5", "13", "14"], "12.5"),
  titleLines: enumOption("sidebar_title_lines", ["one", "two", "hover"], "one"),
  titleSource: enumOption("sidebar_title_source", ["title", "branch", "folder"], "title"),
  status: enumOption("sidebar_row_status", ["shape", "dot", "hidden"], "shape"),
  time: enumOption("sidebar_row_time", ["none", "relative", "absolute"], "relative"),
  branch: boolOption("sidebar_row_branch", false),
  worktreeIcon: boolOption("sidebar_row_worktree_icon", true),
  diff: boolOption("sidebar_row_diff", true),
  pr: boolOption("sidebar_row_pr", true),
  ports: boolOption("sidebar_row_ports", true),
  activity: boolOption("sidebar_row_activity", true),
  label: enumOption("sidebar_row_label", ["chip", "dot", "hidden"], "chip"),
  provider: enumOption("sidebar_row_provider", ["logo", "logo_model", "hidden"], "logo"),
  typeToFilter: boolOption("sidebar_type_to_filter", true),
  pendingRequest: boolOption("sidebar_row_pending_request", true),
  preview: enumOption("sidebar_row_preview", ["none", "last_message"], "none"),
  todos: boolOption("sidebar_row_todos", false),
  uniformRows: boolOption("sidebar_uniform_rows", true),
  compactRows: boolOption("sidebar_compact_rows", false),
  projectBadges: enumOption("sidebar_project_badges", ["count", "dot", "none"], "count"),
  forMe: boolOption("sidebar_block_for_me", true),
  dormantAfter: enumOption("sidebar_dormant_after", ["never", "3", "7", "14", "30"], "7"),
  revealActive: enumOption("sidebar_reveal_active", ["scroll", "expand", "off"], "scroll"),
  rail: enumOption("sidebar_rail", ["projects", "conversations", "attention", "none"], "projects"),
  workingBlock: boolOption("sidebar_block_working", false),
  recentBlock: boolOption("sidebar_block_recent", false),
  recentCount: enumOption("sidebar_recent_count", ["3", "5", "10"], "5"),
  blockCounts: enumOption("sidebar_block_counts", ["count", "dot", "none"], "count"),
  hideEmptyBlocks: boolOption("sidebar_hide_empty_blocks", true),
  gatePopover: enumOption("sidebar_gate_popover", ["auto", "hover", "click"], "auto"),
  flashOnChange: boolOption("sidebar_flash_on_change", true),
  autoCollapse: boolOption("sidebar_auto_collapse", false),
  lens: enumOption(
    "sidebar_lens",
    ["project", "status", "worktree", "provider", "label", "date", "flat"],
    "project",
  ),
  conversationSort: enumOption(
    "sidebar_conversation_sort",
    ["activity", "created", "title"],
    "activity",
  ),
  projectSort: enumOption("sidebar_project_sort", ["frozen", "live", "name"], "frozen"),
  stickyHeaders: boolOption("sidebar_sticky_headers", true),
} as const;

type OptionValue<O> = O extends EnumOption<infer V> ? V : O extends BoolOption ? boolean : never;

export type SidebarOptionId = keyof typeof SIDEBAR_OPTIONS;
export type SidebarConfig = {
  [K in SidebarOptionId]: OptionValue<(typeof SIDEBAR_OPTIONS)[K]>;
};

/**
 * The single switch the sidebar had before the display options. Still read when
 * `sidebar_row_provider` is unset, so turning logos off keeps them off.
 */
export const LEGACY_PROVIDER_LOGOS_KEY = "sidebar_provider_logos";

const OPTION_IDS = Object.keys(SIDEBAR_OPTIONS) as SidebarOptionId[];

/** Every stored key the config reads, legacy switch included (reset clears it too). */
export const SIDEBAR_SETTING_KEYS: readonly string[] = [
  ...OPTION_IDS.map((id) => SIDEBAR_OPTIONS[id].key),
  LEGACY_PROVIDER_LOGOS_KEY,
];

const BOOL_SCHEMA = z.enum(["true", "false"]);

function parseOption(option: SidebarOption, raw: string | null | undefined): string | boolean {
  if (option.kind === "bool") {
    const parsed = BOOL_SCHEMA.safeParse(raw);
    return parsed.success ? parsed.data === "true" : option.fallback;
  }
  const parsed = option.schema.safeParse(raw);
  return parsed.success ? parsed.data : option.fallback;
}

/** Builds the config from stored values; unset or invalid values take the default. */
export function parseSidebarConfig(
  read: (key: string) => string | null | undefined,
): SidebarConfig {
  const entries = OPTION_IDS.map((id) => {
    const option = SIDEBAR_OPTIONS[id];
    return [id, parseOption(option, read(option.key))];
  });
  const config = Object.fromEntries(entries) as SidebarConfig;
  if (read(SIDEBAR_OPTIONS.provider.key) == null && read(LEGACY_PROVIDER_LOGOS_KEY) === "false") {
    config.provider = "hidden";
  }
  return config;
}

export const DEFAULT_SIDEBAR_CONFIG: SidebarConfig = parseSidebarConfig(() => null);

export function serializeSidebarOption(value: string | boolean): string {
  return typeof value === "boolean" ? String(value) : value;
}
