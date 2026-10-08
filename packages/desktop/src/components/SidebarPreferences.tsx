import { createContext, useContext, type ReactNode } from "react";
import { useGetWorkspaceSetting } from "@/api/generated";

export const SIDEBAR_PROVIDER_LOGOS_KEY = "sidebar_provider_logos";
const SidebarProviderLogosContext = createContext(true);

/** One query subscription for the entire sidebar, not one per virtualized row. */
export function SidebarPreferences({ children }: { children: ReactNode }) {
  const { data } = useGetWorkspaceSetting(SIDEBAR_PROVIDER_LOGOS_KEY);
  return (
    <SidebarProviderLogosContext.Provider value={data?.value !== "false"}>
      {children}
    </SidebarProviderLogosContext.Provider>
  );
}

export function useSidebarProviderLogos(): boolean {
  return useContext(SidebarProviderLogosContext);
}
