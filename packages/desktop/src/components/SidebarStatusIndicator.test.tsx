import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { DEFAULT_SIDEBAR_CONFIG } from "@/lib/sidebar-config";
import { useSidebarConfigStore } from "@/stores/sidebar-config-store";
import { SidebarContext } from "./SidebarContext";
import { SidebarSurfaceContext } from "@/stores/sidebar-surface-store";
import { SidebarStatusIndicator } from "./SidebarStatusIndicator";

const gate = vi.hoisted(() => ({
  kind: "permission" as "permission" | "question",
  setOpen: vi.fn(),
  usePopoverOpen: vi.fn(),
}));

vi.mock("@/stores/session-status-selectors", () => ({
  useFeatureStatus: () => ({ status: "question", kind: gate.kind }),
}));

const working = { state: "working", sourceFeatureId: 42 } as const;
const unread = { state: "unread", sourceFeatureId: 42 } as const;
const idle = { state: "idle", sourceFeatureId: 42 } as const;
const waiting = { state: "waiting", sourceFeatureId: 42 } as const;
vi.mock("@/hooks/usePendingGatePopoverOpen", () => ({
  usePendingGatePopoverOpen: gate.usePopoverOpen,
}));
vi.mock("@/hooks/useFeaturePendingGate", () => ({
  useFeaturePendingGate: () => ({ isLoading: false, isSubmitting: false }),
}));

describe("sidebar status", () => {
  beforeEach(() => {
    // No "For me" block here: the tree owns the gate popover's auto-open.
    useSidebarConfigStore.setState({ config: { ...DEFAULT_SIDEBAR_CONFIG, forMe: false } });
    gate.setOpen.mockClear();
    gate.usePopoverOpen.mockReset().mockReturnValue({
      open: false,
      setOpen: gate.setOpen,
      setHovered: vi.fn(),
      hoveredFeatureId: null,
    });
  });

  it("prioritizes ongoing work over unread completion, then clears completion once read", () => {
    const props = { isActive: false, onOpenConversation: vi.fn() };
    const { rerender } = render(<SidebarStatusIndicator {...props} attention={working} />);
    expect(screen.getByRole("img", { name: "Agent working" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Unread agent messages" })).not.toBeInTheDocument();

    rerender(<SidebarStatusIndicator {...props} attention={unread} />);
    expect(screen.getByRole("img", { name: "Unread agent messages" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Agent working" })).not.toBeInTheDocument();

    rerender(<SidebarStatusIndicator {...props} attention={idle} />);
    expect(screen.getByRole("img", { name: "Agent idle" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Unread agent messages" })).not.toBeInTheDocument();
  });

  it.each([
    ["permission", "text-amber-400", "lucide-shield-alert"],
    ["question", "text-primary", "lucide-message-circle-question-mark"],
  ] as const)(
    "keeps the %s indicator interactive without a provider logo",
    async (kind, color, icon) => {
      gate.kind = kind;
      const onNavigate = vi.fn();
      const { user } = render(
        <div onClick={onNavigate}>
          <SidebarStatusIndicator
            attention={waiting}
            isActive={false}
            onOpenConversation={onNavigate}
          />
        </div>,
      );
      const trigger = screen.getByRole("button", { name: `Pending ${kind}` });
      expect(trigger).toHaveClass(color);
      expect(trigger.querySelector("svg")).toHaveClass("sidebar-pending-indicator", icon);
      expect(gate.usePopoverOpen).toHaveBeenCalledWith(42, true);
      expect(screen.queryByLabelText("Unread agent messages")).not.toBeInTheDocument();
      await user.click(trigger);
      expect(gate.setOpen).toHaveBeenCalledWith(true);
      expect(onNavigate).not.toHaveBeenCalled();
    },
  );

  it("suppresses automatic gate popovers for the active conversation", () => {
    render(<SidebarStatusIndicator attention={waiting} isActive onOpenConversation={vi.fn()} />);
    expect(gate.usePopoverOpen).toHaveBeenCalledWith(42, false);
  });

  it("auto-opens on one surface only: For me over the tree, the rail when collapsed", () => {
    useSidebarConfigStore.setState({
      config: { ...DEFAULT_SIDEBAR_CONFIG, rail: "attention" },
    });
    const indicator = (
      <SidebarStatusIndicator attention={waiting} isActive={false} onOpenConversation={vi.fn()} />
    );
    const { rerender } = render(indicator);
    expect(gate.usePopoverOpen).toHaveBeenLastCalledWith(42, false);

    rerender(
      <SidebarSurfaceContext.Provider value="for-me">{indicator}</SidebarSurfaceContext.Provider>,
    );
    expect(gate.usePopoverOpen).toHaveBeenLastCalledWith(42, true);

    const collapsed = { collapsed: true, setCollapsed: vi.fn() };
    rerender(
      <SidebarContext.Provider value={collapsed}>
        <SidebarSurfaceContext.Provider value="for-me">{indicator}</SidebarSurfaceContext.Provider>
      </SidebarContext.Provider>,
    );
    expect(gate.usePopoverOpen).toHaveBeenLastCalledWith(42, false);
    rerender(
      <SidebarContext.Provider value={collapsed}>
        <SidebarSurfaceContext.Provider value="rail">{indicator}</SidebarSurfaceContext.Provider>
      </SidebarContext.Provider>,
    );
    expect(gate.usePopoverOpen).toHaveBeenLastCalledWith(42, true);
  });

  it("still flashes its row when the status style hides the slot", () => {
    useSidebarConfigStore.setState({
      config: { ...DEFAULT_SIDEBAR_CONFIG, forMe: false, status: "hidden" },
    });
    const props = { isActive: false, onOpenConversation: vi.fn() };
    const row = (attention: typeof working | typeof unread) => (
      <div data-nav-type="feature" data-testid="row">
        <SidebarStatusIndicator {...props} attention={attention} />
      </div>
    );
    const { rerender } = render(row(working));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    rerender(row(unread));
    expect(screen.getByTestId("row")).toHaveAttribute("data-sidebar-flash", "unread");
  });
});
