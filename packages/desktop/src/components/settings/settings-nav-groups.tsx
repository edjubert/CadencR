import {
  Bell,
  BrainCircuit,
  Code2,
  GitMerge,
  Globe,
  Info,
  MonitorCog,
  Network,
  Palette,
  Plug,
} from "lucide-react";
import type { SettingsNavGroup } from "./SettingsNavSidebar";

/**
 * Sidebar sections for the settings page, in render order.
 *
 * Each `id` must match the anchor on the corresponding section in
 * `routes/settings.tsx` — `?section=<id>` deep links scroll to it by id.
 */
export const NAV_GROUPS: SettingsNavGroup[] = [
  {
    label: "General",
    items: [
      { id: "appearance", label: "Appearance", icon: <Palette className="size-4" /> },
      { id: "editor", label: "Editor", icon: <Code2 className="size-4" /> },
      { id: "interface", label: "Interface & Zoom", icon: <MonitorCog className="size-4" /> },
      { id: "notifications", label: "Notifications", icon: <Bell className="size-4" /> },
      { id: "browser", label: "Browser", icon: <Globe className="size-4" /> },
    ],
  },
  {
    label: "MCP",
    items: [{ id: "mcp", label: "MCP", icon: <Network className="size-4" /> }],
  },
  {
    label: "Agents",
    items: [{ id: "runtime", label: "Runtime & Models", icon: <BrainCircuit className="size-4" /> }],
  },
  {
    label: "Source Control",
    items: [{ id: "git", label: "Git", icon: <GitMerge className="size-4" /> }],
  },
  {
    label: "Providers",
    items: [{ id: "providers", label: "CLI Providers", icon: <Plug className="size-4" /> }],
  },
  {
    label: "About",
    items: [{ id: "about", label: "About Cadencr", icon: <Info className="size-4" /> }],
  },
];
