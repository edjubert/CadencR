import type { SidebarOptionId } from "@/lib/sidebar-config";
import { CHOICE_ROWS, SWITCH_ROWS } from "./sidebar-display-rows";

/** One line of the display options: an option, or the row element checkboxes. */
export type DisplayItem = SidebarOptionId | "rowElements";

export interface DisplayGroup {
  id: string;
  label: string;
  items: readonly DisplayItem[];
}

/**
 * The options in the order both layouts show them, under the presets: what
 * changes the sidebar most first, the rest grouped by what they act on. The
 * popover folds every group after the first.
 */
export const DISPLAY_GROUPS: readonly DisplayGroup[] = [
  { id: "essentials", label: "Essentials", items: ["density", "status", "time"] },
  {
    id: "rows",
    label: "Rows",
    items: [
      "fontSize",
      "titleLines",
      "titleSource",
      "label",
      "provider",
      "preview",
      "uniformRows",
      "compactRows",
      "rowElements",
    ],
  },
  {
    id: "blocks",
    label: "Blocks",
    items: [
      "forMe",
      "workingBlock",
      "recentBlock",
      "recentCount",
      "blockCounts",
      "hideEmptyBlocks",
    ],
  },
  {
    id: "organize",
    label: "Organize",
    items: [
      "lens",
      "conversationSort",
      "projectSort",
      "stickyHeaders",
      "projectBadges",
      "dormantAfter",
      "revealActive",
    ],
  },
  { id: "attention", label: "Attention", items: ["gatePopover", "flashOnChange"] },
  {
    id: "collapsing",
    label: "Collapsing & filter",
    items: ["rail", "autoCollapse", "typeToFilter"],
  },
];

const CHOICE_BY_ID = new Map<string, (typeof CHOICE_ROWS)[number]>(
  CHOICE_ROWS.map((row) => [row.id, row]),
);
const SWITCH_BY_ID = new Map<string, (typeof SWITCH_ROWS)[number]>(
  SWITCH_ROWS.map((row) => [row.id, row]),
);

/** What a group item renders: a segmented choice, a switch, or the row element checkboxes. */
export function resolveDisplayItem(
  item: DisplayItem,
):
  | { kind: "choice"; row: (typeof CHOICE_ROWS)[number] }
  | { kind: "switch"; row: (typeof SWITCH_ROWS)[number] }
  | { kind: "rowElements" } {
  if (item === "rowElements") return { kind: "rowElements" };
  const choice = CHOICE_BY_ID.get(item);
  if (choice) return { kind: "choice", row: choice };
  const toggle = SWITCH_BY_ID.get(item);
  if (toggle) return { kind: "switch", row: toggle };
  throw new Error(`Sidebar option ${item} has no display row`);
}
