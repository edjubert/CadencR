// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentType } from "react";

const mocks = vi.hoisted(() => ({
  search: {} as { tab?: "general" | "marketplace"; section?: string },
  navigate: vi.fn(),
  persist: vi.fn(),
  realSetting: false,
  marketplaceEnabled: true,
}));
vi.mock("@/lib/marketplace-gate", () => ({
  get MARKETPLACE_ENABLED() {
    return mocks.marketplaceEnabled;
  },
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: ComponentType }) => ({
    options,
    useSearch: () => mocks.search,
  }),
  useNavigate: () => mocks.navigate,
}));
vi.mock("@/hooks/useShortcut", () => ({ useShortcut: vi.fn() }));
vi.mock("@/api/generated", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  return {
    getGetWorkspaceSettingQueryKey: (key: string) => ["workspace", "setting", key],
    useGetWorkspaceSetting: (key: string) =>
      useQuery({
        queryKey: ["workspace", "setting", key],
        queryFn: () => ({ value: "old" }),
        initialData: { value: "old" },
        staleTime: Infinity,
      }),
    useSetWorkspaceSetting: () => ({
      mutate: mocks.persist,
      mutateAsync: (args: { data: { value: string } }) => {
        mocks.persist(args);
        return Promise.resolve({ value: args.data.value });
      },
      isPending: false,
    }),
  };
});
vi.mock("@/components/settings/GeneralSettingsSections", async () => {
  const { useDebouncedSetting } = await import("@/hooks/useDebouncedSetting");
  function SettingFixture() {
    const setting = useDebouncedSetting("regression_setting");
    return (
      <input
        aria-label="Setting regression"
        value={setting.value ?? ""}
        onChange={(event) => setting.setValue(event.target.value)}
      />
    );
  }
  return {
    GeneralSettingsSections: () =>
      mocks.realSetting ? <SettingFixture /> : <div id="appearance">General content</div>,
  };
});
vi.mock("@/components/MarketplaceSection", () => ({
  MarketplaceSection: () => <div>Marketplace content</div>,
}));
vi.mock("@/components/settings/SettingsNavSidebar", () => ({
  SettingsNavSidebar: () => <nav aria-label="General sections" />,
}));
import { Route } from "./settings";
const SettingsPage = Route.options.component as ComponentType;

afterEach(() => {
  cleanup();
  mocks.search = {};
  mocks.navigate.mockClear();
  mocks.persist.mockClear();
  mocks.realSetting = false;
  mocks.marketplaceEnabled = true;
  vi.useRealTimers();
});

describe("Settings views", () => {
  it.each([{ tab: "marketplace" as const }, { section: "marketplace" }, {}])(
    "falls back to General without mounting marketplace when disabled: %j",
    (search) => {
      mocks.marketplaceEnabled = false;
      mocks.search = search;
      render(<SettingsPage />);
      expect(screen.queryByRole("tab", { name: "Marketplace" })).toBeNull();
      expect(screen.queryByText("Marketplace content")).toBeNull();
      expect(screen.getByText("General content")).toBeTruthy();
    },
  );

  it("mounts only General by default and exposes accessible tabs", () => {
    render(<SettingsPage />);
    expect(screen.getByRole("tablist", { name: "Settings views" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "General" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("General content")).toBeTruthy();
    expect(screen.queryByText("Marketplace content")).toBeNull();
  });

  it("keeps the heading and tabs in one compact strip without promotional or duplicate copy", () => {
    mocks.search = { tab: "marketplace" };
    render(<SettingsPage />);
    const header = screen.getByRole("heading", { name: "Settings" }).closest("header");
    expect(header).toContainElement(screen.getByRole("tablist", { name: "Settings views" }));
    expect(header).toContainElement(screen.getByRole("button", { name: "Back to workspace" }));
    expect(header).toHaveClass("min-h-11", "items-center");
    expect(screen.queryByText("Make Cadencr your own.")).toBeNull();
    expect(screen.queryByText("Cadencr")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Marketplace" })).toBeNull();
    expect(screen.queryByText(/Discover signed agent providers/)).toBeNull();
  });

  it("mounts only Marketplace for legacy deep links", () => {
    mocks.search = { section: "marketplace" };
    render(<SettingsPage />);
    expect(screen.getByText("Marketplace content")).toBeTruthy();
    expect(screen.queryByText("General content")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "General sections" })).toBeNull();
  });

  it("supports keyboard tab navigation without a mouse", async () => {
    render(<SettingsPage />);
    const general = screen.getByRole("tab", { name: "General" });
    general.focus();
    fireEvent.keyDown(general, { key: "ArrowRight" });
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: "/settings",
        search: { tab: "marketplace" },
      }),
    );
  });

  it("persists a real debounced setting once after rapidly switching away", async () => {
    vi.useFakeTimers();
    mocks.realSetting = true;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = () => (
      <QueryClientProvider client={client}>
        <SettingsPage />
      </QueryClientProvider>
    );
    const { rerender } = render(view());
    fireEvent.change(screen.getByRole("textbox", { name: "Setting regression" }), {
      target: { value: "new" },
    });
    mocks.search = { tab: "marketplace" };
    rerender(view());
    expect(screen.queryByRole("textbox", { name: "Setting regression" })).toBeNull();
    expect(screen.getByLabelText("Setting regression").closest("[role=tabpanel]")).toHaveStyle({
      display: "none",
    });
    expect(mocks.persist).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(mocks.persist).toHaveBeenCalledTimes(1);
    expect(mocks.persist).toHaveBeenCalledWith({
      key: "regression_setting",
      data: { value: "new" },
    });
    mocks.search = { tab: "general" };
    rerender(view());
    expect(screen.getByRole("textbox", { name: "Setting regression" })).toHaveValue("new");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(mocks.persist).toHaveBeenCalledTimes(1);
  });

  it("writes tab selection to router search and follows URL changes", () => {
    const { rerender } = render(<SettingsPage />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Marketplace" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/settings",
      search: { tab: "marketplace" },
    });
    mocks.search = { tab: "marketplace" };
    rerender(<SettingsPage />);
    expect(screen.getByText("Marketplace content")).toBeTruthy();
    mocks.search = { tab: "general" };
    rerender(<SettingsPage />);
    expect(screen.getByText("General content")).toBeTruthy();
    expect(screen.getByText("Marketplace content").closest("[role=tabpanel]")).toHaveAttribute(
      "hidden",
    );
    expect(screen.getByText("Marketplace content").closest("[role=tabpanel]")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });
});
