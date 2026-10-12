import { useEffect, useMemo, useState } from "react";
import { z } from "zod";

const settingsSearchSchema = z.object({
  tab: z.enum(["general", "marketplace"]).optional().catch(undefined),
  section: z.string().optional().catch(undefined),
});

export type SettingsSearch = z.infer<typeof settingsSearchSchema>;

export function parseSettingsSearch(search: Record<string, unknown>): SettingsSearch {
  return settingsSearchSchema.parse(search);
}

export function resolveSettingsTab(search: SettingsSearch): "general" | "marketplace" {
  return search.tab ?? (search.section === "marketplace" ? "marketplace" : "general");
}

/** Retain visited views so pending settings saves and mutation callbacks survive tab changes. */
export function useVisitedSettingsViews(activeTab: "general" | "marketplace") {
  const [visited, setVisited] = useState(() => ({
    general: activeTab === "general",
    marketplace: activeTab === "marketplace",
  }));
  useEffect(() => {
    setVisited((previous) => (previous[activeTab] ? previous : { ...previous, [activeTab]: true }));
  }, [activeTab]);
  return useMemo(
    () => ({
      general: visited.general || activeTab === "general",
      marketplace: visited.marketplace || activeTab === "marketplace",
    }),
    [visited, activeTab],
  );
}
