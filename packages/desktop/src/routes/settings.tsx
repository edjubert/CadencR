import { useEffect, useRef } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useShortcut } from "@/hooks/useShortcut";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MarketplaceSection } from "@/components/MarketplaceSection";
import { GeneralSettingsSections } from "@/components/settings/GeneralSettingsSections";
import { SettingsNavSidebar } from "@/components/settings/SettingsNavSidebar";
import { NAV_GROUPS } from "@/components/settings/settings-nav-groups";
import {
  parseSettingsSearch,
  resolveSettingsTab,
  useVisitedSettingsViews,
} from "@/components/settings/settings-navigation";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
  validateSearch: parseSettingsSearch,
});

function SettingsPage() {
  const search = Route.useSearch();
  const activeTab = resolveSettingsTab(search);
  const visited = useVisitedSettingsViews(activeTab);
  const navigate = useNavigate();
  const mainRef = useRef<HTMLElement | null>(null);
  const goBack = () => {
    void navigate({ to: "/" });
  };

  // Preserve the existing Escape behavior, including inside form controls.
  useShortcut("settings-back", (e) => {
    e.preventDefault();
    goBack();
  });

  useEffect(() => {
    if (activeTab !== "general" || !search.section) return;
    document.getElementById(search.section)?.scrollIntoView({ block: "start" });
  }, [activeTab, search.section]);

  return (
    <Tabs
      value={activeTab}
      onValueChange={(tab) => {
        if (tab !== "general" && tab !== "marketplace") return;
        void navigate({ to: "/settings", search: { tab } });
      }}
      className="h-full min-h-0 bg-background text-foreground"
    >
      <SettingsPageHeader onBack={goBack} />
      <TabsContent
        value="general"
        forceMount
        hidden={activeTab !== "general"}
        aria-hidden={activeTab !== "general"}
        inert={activeTab !== "general"}
        style={activeTab !== "general" ? { display: "none" } : undefined}
        className="overflow-hidden data-[state=active]:flex"
      >
        {visited.general && (
          <>
            {activeTab === "general" && (
              <SettingsNavSidebar groups={NAV_GROUPS} scrollRef={mainRef} />
            )}
            <main ref={mainRef} className="relative min-w-0 flex-1 overflow-y-auto">
              <div className="mx-auto max-w-[820px] space-y-6 px-4 py-6 md:px-10 md:py-8">
                <GeneralSettingsSections />
                <div className="h-12" />
              </div>
            </main>
          </>
        )}
      </TabsContent>
      <TabsContent
        value="marketplace"
        forceMount
        hidden={activeTab !== "marketplace"}
        aria-hidden={activeTab !== "marketplace"}
        inert={activeTab !== "marketplace"}
        style={activeTab !== "marketplace" ? { display: "none" } : undefined}
        className="overflow-y-auto"
      >
        {visited.marketplace && (
          <main className="mx-auto max-w-[1100px] p-4">
            <MarketplaceSection />
          </main>
        )}
      </TabsContent>
    </Tabs>
  );
}

function SettingsPageHeader({ onBack }: { onBack: () => void }): React.JSX.Element {
  return (
    <header className="flex min-h-11 shrink-0 items-center gap-3 border-b border-border px-4">
      <h1 className="shrink-0 text-sm font-semibold">Settings</h1>
      <TabsList aria-label="Settings views" className="h-11 min-w-0 flex-1 border-b-0">
        <TabsTrigger value="general" className="px-2">
          General
        </TabsTrigger>
        <TabsTrigger value="marketplace" className="px-2">
          Marketplace
        </TabsTrigger>
      </TabsList>
      <Button
        variant="ghost"
        size="sm"
        onClick={onBack}
        title="Back to workspace (Esc)"
        aria-label="Back to workspace"
        className="h-7 shrink-0 gap-1.5 px-2"
      >
        <ArrowLeft aria-hidden="true" className="size-3.5" />
        <span className="hidden sm:inline">Back</span>
      </Button>
    </header>
  );
}
