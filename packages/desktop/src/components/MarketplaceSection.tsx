import { useMemo, useState } from "react";
import { Loader2, RefreshCw, Blocks, Package, Palette } from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMarketplace } from "@/hooks/useMarketplace";
import {
  groupPackages,
  usableCatalog,
  marketplaceError,
  providerCatalogPackages,
} from "@/lib/marketplace";
import { MarketplaceDetails } from "./MarketplaceDetails";
import { MarketplacePolicy } from "./MarketplacePolicy";
import { InstalledProvider } from "./InstalledProvider";
import { ThemeMarketplace } from "./ThemeMarketplace";
import {
  MarketplaceSearch,
  MarketplaceEmpty,
  MarketplaceDisclosure,
} from "./MarketplacePresentation";

export function MarketplaceSection(): React.JSX.Element {
  const { catalogQuery, inventoryQuery, refresh, mutation, notice } = useMarketplace();
  const [view, setView] = useState<"browse" | "installed" | "themes">("browse");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const catalog = catalogQuery.data;
  const inventory = inventoryQuery.data;
  const groups = useMemo(() => groupPackages(providerCatalogPackages(catalog?.index)), [catalog]);
  const filtered = useMemo(
    () =>
      groups.filter((entries) =>
        `${entries[0].agent.name} ${entries[0].agent.id} ${entries[0].agent.description} ${entries[0].host.publisher}`
          .toLowerCase()
          .includes(search.toLowerCase().trim()),
      ),
    [groups, search],
  );
  const selected = groups.find((entries) => entries[0].agent.id === selectedId);
  const current = usableCatalog(catalog);
  return (
    <div id="marketplace" className="min-w-0 space-y-2">
      <Tabs
        value={view}
        onValueChange={(value) => {
          if (value === "browse" || value === "installed" || value === "themes") setView(value);
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList
            aria-label="Marketplace views"
            className="h-auto w-auto flex-1 flex-wrap justify-start gap-1"
          >
            <TabsTrigger value="browse">
              <Blocks aria-hidden="true" className="size-3.5" />
              Browse
            </TabsTrigger>
            <TabsTrigger value="installed">
              <Package aria-hidden="true" className="size-3.5" />
              Installed ({inventory?.providers.length ?? 0})
            </TabsTrigger>
            <TabsTrigger value="themes">
              <Palette aria-hidden="true" className="size-3.5" />
              Themes
            </TabsTrigger>
          </TabsList>
          {view !== "themes" && (
            <MarketplaceToolbar refresh={refresh} catalogQuery={catalogQuery} />
          )}
        </div>
        <MarketplaceStatus
          catalogQuery={catalogQuery}
          inventoryQuery={inventoryQuery}
          refresh={refresh}
          mutation={mutation}
          notice={notice}
          showCatalog={view !== "themes"}
        />
        <MarketplaceBrowse
          search={search}
          setSearch={setSearch}
          current={current}
          filtered={filtered}
          hasPackages={groups.length > 0}
          onSelect={(id) => {
            setSelectedId(id);
          }}
        />
        <MarketplaceInstalled inventoryQuery={inventoryQuery} mutation={mutation} />
        <TabsContent value="themes">
          <ThemeMarketplace />
        </TabsContent>
        {view !== "themes" && (
          <MarketplaceDiagnostics catalogQuery={catalogQuery} inventoryQuery={inventoryQuery} />
        )}
      </Tabs>
      {selected && (
        <MarketplaceDetails
          key={selectedId}
          packages={selected}
          recommendedVersion={catalog?.recommended_versions?.[selected[0].agent.id]}
          installed={inventory?.providers.find((entry) => entry.id === selectedId)}
          index={catalog?.index}
          canInstall={
            current &&
            !!inventory &&
            !inventoryQuery.isError &&
            inventory.trust.status === "configured"
          }
          mutation={mutation}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

function MarketplaceStatus({
  catalogQuery,
  inventoryQuery,
  refresh,
  mutation,
  notice,
  showCatalog,
}: ReturnType<typeof useMarketplace> & { showCatalog: boolean }): React.JSX.Element {
  const catalog = catalogQuery.data;
  const inventory = inventoryQuery.data;
  const errors = [
    catalogQuery.error &&
      `${showCatalog ? "" : "Provider catalog: "}${marketplaceError(catalogQuery.error)}`,
    inventoryQuery.error &&
      `${showCatalog ? "" : "Installed providers: "}${marketplaceError(inventoryQuery.error)}`,
    refresh.error &&
      `${showCatalog ? "" : "Provider catalog refresh: "}${marketplaceError(refresh.error)}`,
    marketplaceError(mutation.error),
  ];
  return (
    <div className="space-y-1 text-xs break-words" aria-live="polite">
      {showCatalog && (catalogQuery.isPending || inventoryQuery.isPending) && (
        <p role="status" className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading marketplace…
        </p>
      )}
      {errors.filter(Boolean).map((error, i) => (
        <p key={i} role="alert" className="text-destructive">
          {error}
        </p>
      ))}
      {catalog?.error &&
        (showCatalog || catalog.error_code !== "MANAGED_CATALOG_SOURCE_NOT_CONFIGURED") &&
        (catalog.error_code === "MANAGED_CATALOG_SOURCE_NOT_CONFIGURED" &&
        !usableCatalog(catalog) ? (
          <p className="text-muted-foreground">
            Catalog not available in this build. Installed providers remain manageable.
          </p>
        ) : (
          <p role="alert" className="text-destructive">
            {!showCatalog && "Provider catalog: "}
            {catalog.error}
          </p>
        ))}
      {showCatalog &&
        catalog &&
        !catalogQuery.isPending &&
        !catalog.error &&
        !usableCatalog(catalog) && (
          <p className="text-muted-foreground">
            {catalog.source_configured
              ? "No current verified catalog is available. Refresh to retry; installed providers can still be managed."
              : "The catalog source is not configured in this build. Browse and installation are unavailable; installed providers remain manageable."}
          </p>
        )}
      {showCatalog && inventory?.blocklist.error && (
        <p role="alert" className="text-destructive">
          Blocklist: {inventory.blocklist.error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {mutation.isPending && <p role="status">Applying provider change…</p>}
      {(inventoryQuery.isError || catalogQuery.isError) && (
        <Button
          size="sm"
          variant="outline"
          disabled={inventoryQuery.isFetching || catalogQuery.isFetching}
          onClick={() => {
            void inventoryQuery.refetch();
            void catalogQuery.refetch();
          }}
        >
          Retry loading
        </Button>
      )}
    </div>
  );
}

function MarketplaceBrowse({
  search,
  setSearch,
  current,
  filtered,
  hasPackages,
  onSelect,
}: {
  search: string;
  setSearch: (value: string) => void;
  current: boolean;
  filtered: ReturnType<typeof groupPackages>;
  hasPackages: boolean;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  return (
    <TabsContent value="browse" className="space-y-2 pt-2">
      <MarketplaceSearch
        label="Search marketplace"
        placeholder="Search providers or publishers…"
        value={search}
        onChange={setSearch}
      />
      {!current ? null : filtered.length ? (
        <div className="h-80 overflow-hidden rounded-lg border border-border px-3">
          <Virtuoso
            data={filtered}
            itemContent={(_, entries) => (
              <div className="flex flex-col items-start justify-between gap-2 border-b border-border py-3 sm:flex-row">
                <div className="min-w-0">
                  <h3 className="text-sm font-medium">{entries[0].agent.name}</h3>
                  <p className="line-clamp-2 text-sm text-muted-foreground">
                    {entries[0].agent.description}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {entries[0].host.publisher} · {entries.length} version
                    {entries.length === 1 ? "" : "s"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    onSelect(entries[0].agent.id);
                  }}
                >
                  Details
                </Button>
              </div>
            )}
          />
        </div>
      ) : (
        <MarketplaceEmpty>
          {hasPackages
            ? "No providers match your search."
            : "The verified catalog has no providers yet."}
        </MarketplaceEmpty>
      )}
    </TabsContent>
  );
}

function MarketplaceToolbar({
  refresh,
  catalogQuery,
}: Pick<ReturnType<typeof useMarketplace>, "refresh" | "catalogQuery">): React.JSX.Element {
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={refresh.isPending || catalogQuery.isFetching}
      onClick={() => refresh.mutate()}
    >
      <RefreshCw className="size-4" />
      {refresh.isPending || catalogQuery.isFetching ? "Refreshing…" : "Refresh catalog"}
    </Button>
  );
}

function MarketplaceInstalled({
  inventoryQuery,
  mutation,
}: Pick<ReturnType<typeof useMarketplace>, "inventoryQuery" | "mutation">): React.JSX.Element {
  return (
    <TabsContent value="installed" className="space-y-2 pt-2">
      {inventoryQuery.isPending ? (
        <p role="status" className="py-4 text-sm">
          Loading installed providers…
        </p>
      ) : inventoryQuery.data?.providers.length ? (
        <div className="h-80 overflow-hidden rounded-lg border border-border px-3">
          <Virtuoso
            data={inventoryQuery.data.providers}
            itemContent={(_, entry) => <InstalledProvider entry={entry} mutation={mutation} />}
          />
        </div>
      ) : (
        <MarketplaceEmpty>
          {inventoryQuery.isError
            ? "Installed providers could not be loaded."
            : "No managed providers installed."}
        </MarketplaceEmpty>
      )}
    </TabsContent>
  );
}

function MarketplaceDiagnostics({
  catalogQuery,
  inventoryQuery,
}: Pick<ReturnType<typeof useMarketplace>, "catalogQuery" | "inventoryQuery">): React.JSX.Element {
  const catalog = catalogQuery.data;
  const inventory = inventoryQuery.data;
  return (
    <div className="mt-2">
      {(catalog || inventory) && (
        <MarketplaceDisclosure>
          {catalog?.error && (
            <p>
              {catalog.error_code}: {catalog.error}
            </p>
          )}
          {usableCatalog(catalog) && (
            <p className="text-muted-foreground">
              {catalog?.used_cached_verified_catalog
                ? "Using verified cached catalog"
                : "Verified catalog refreshed"}{" "}
              · signer {catalog?.signer_key_id} · expires {catalog?.expires_at}
            </p>
          )}
          {inventory?.trust.status !== "configured" && inventory && (
            <p className="text-muted-foreground">
              Signing trust: {inventory.trust.status}. {inventory.trust.error}
            </p>
          )}
          {inventory && <MarketplacePolicy inventory={inventory} />}
        </MarketplaceDisclosure>
      )}
    </div>
  );
}
