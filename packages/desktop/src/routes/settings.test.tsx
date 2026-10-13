import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils";
import React from "react";
import { FORGE_SETTINGS_ANCHOR } from "@/lib/settings-anchors";

const mocks = vi.hoisted(() => {
  const mockGetWorkspaceSetting = vi.fn(() => ({
    data: { value: "1" },
    isSuccess: true,
  }));
  const mockSetWorkspaceSetting = vi.fn(() => ({
    mutate: vi.fn(),
    isLoading: false,
  }));
  const mockUseSearch = vi.fn(() => ({}) as { section?: string });
  return { mockGetWorkspaceSetting, mockSetWorkspaceSetting, mockUseSearch };
});

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: (_path: string) => (opts: { component: unknown }) => ({
    options: opts,
    useSearch: mocks.mockUseSearch,
    useParams: vi.fn(() => ({})),
  }),
  useNavigate: () => vi.fn(),
  useRouterState: (options?: {
    select?: (state: {
      location: { pathname: string; search?: Record<string, unknown> };
    }) => unknown;
  }) => {
    const state = { location: { pathname: "/settings" } };
    return options?.select ? options.select(state) : state;
  },
  Link: ({ children, to }: { children: unknown; to: string }) => {
    const React = require("react");
    return React.createElement("a", { href: to }, children);
  },
}));

vi.mock("@tanstack/react-hotkeys", () => ({ useHotkeys: vi.fn() }));
vi.mock("../api/generated", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/generated")>()),
  useGetWorkspaceSetting: mocks.mockGetWorkspaceSetting,
  useSetWorkspaceSetting: mocks.mockSetWorkspaceSetting,
  getGetWorkspaceSettingQueryKey: vi.fn((key: string) => ["workspace", "setting", key]),
}));

vi.mock("../components/ModelSelector", () => ({
  ModelSelector: ({ level }: { level: string }) => (
    <div data-testid="model-selector" data-level={level}>
      ModelSelector
    </div>
  ),
}));

import { Route } from "./settings";

function SettingsPage() {
  const Component = (Route as unknown as { options: { component: React.ComponentType } }).options
    ?.component;
  if (!Component) return null;
  return <Component />;
}

describe("SettingsPage route", () => {
  beforeEach(() => {
    mocks.mockGetWorkspaceSetting.mockReturnValue({
      data: { value: "1" },
      isSuccess: true,
    });
    mocks.mockUseSearch.mockReturnValue({});
    vi.mocked(HTMLElement.prototype.scrollIntoView).mockClear();
  });

  it("renders the settings heading", () => {
    render(<SettingsPage />);
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
  });

  it("renders the sidebar nav with grouped sections", () => {
    render(<SettingsPage />);
    // sidebar nav buttons (the visible ones, not the section headings)
    expect(screen.getAllByRole("button", { name: /Appearance/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /^MCP$/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /CLI Providers/ }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Session Defaults/ })).not.toBeInTheDocument();
  });

  it("renders MCP as its own settings section", () => {
    render(<SettingsPage />);
    expect(screen.getByRole("heading", { name: "MCP" })).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: /workspace memory for agents/i }),
    ).toBeInTheDocument();
  });

  it("renders the auto-naming section with the model selector and prompt", () => {
    render(<SettingsPage />);
    expect(screen.getByRole("heading", { name: "Auto-naming" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Naming prompt" })).toBeInTheDocument();
    expect(screen.getByTestId("model-selector")).toBeInTheDocument();
  });

  it("does not render removed session autonomy or parallel defaults", () => {
    render(<SettingsPage />);
    expect(screen.queryByRole("radiogroup", { name: /agent autonomy/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Parallel agent execution/i)).not.toBeInTheDocument();
  });

  it("renders git merge-strategy radio group", () => {
    render(<SettingsPage />);
    expect(screen.getByRole("heading", { name: "Git" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: /merge strategy/i })).toBeInTheDocument();
    expect(screen.getByText("--no-ff")).toBeInTheDocument();
  });

  it("scrolls a ?section deep link to the anchor it names", () => {
    // The forge onboarding button in the PR pane sends the user here. Both
    // halves are silent when broken: a renamed anchor id resolves to nothing and
    // strands the user at the top of the page with no error at all.
    mocks.mockUseSearch.mockReturnValue({ section: FORGE_SETTINGS_ANCHOR });

    const { container } = render(<SettingsPage />);

    const anchor = container.querySelector(`#${FORGE_SETTINGS_ANCHOR}`);
    expect(anchor).not.toBeNull();
    expect(vi.mocked(HTMLElement.prototype.scrollIntoView).mock.contexts).toContain(anchor);
  });

  it("leaves the page at the top when no section is requested", () => {
    render(<SettingsPage />);

    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("does not render the removed loader-style option", () => {
    render(<SettingsPage />);
    expect(screen.queryByText("Loader style")).not.toBeInTheDocument();
    expect(screen.queryByText("Usage Glow")).not.toBeInTheDocument();
  });
});
