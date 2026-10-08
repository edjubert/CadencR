import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { SidebarStatusIndicator } from "./SidebarStatusIndicator";

const gate = vi.hoisted(() => ({
  kind: "permission" as "permission" | "question",
  setOpen: vi.fn(),
  usePopoverOpen: vi.fn(),
}));

vi.mock("@/stores/session-status-selectors", () => ({
  useFeatureStatus: () => ({ status: "question", kind: gate.kind }),
}));
vi.mock("@/hooks/usePendingGatePopoverOpen", () => ({
  usePendingGatePopoverOpen: gate.usePopoverOpen,
}));
vi.mock("@/hooks/useFeaturePendingGate", () => ({
  useFeaturePendingGate: () => ({ isLoading: false, isSubmitting: false }),
}));

describe("sidebar status", () => {
  beforeEach(() => {
    gate.setOpen.mockClear();
    gate.usePopoverOpen.mockReset().mockReturnValue({
      open: false,
      setOpen: gate.setOpen,
      setHovered: vi.fn(),
      hoveredFeatureId: null,
    });
  });

  it("prioritizes ongoing work over unread completion, then clears completion once read", () => {
    const props = {
      featureId: 42,
      isActive: false,
      onOpenConversation: vi.fn(),
    };
    const { rerender } = render(<SidebarStatusIndicator {...props} liveStatus="agent" isUnread />);
    expect(screen.getByRole("img", { name: "Agent working" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Unread agent messages" })).not.toBeInTheDocument();

    rerender(<SidebarStatusIndicator {...props} liveStatus="idle" isUnread />);
    expect(screen.getByRole("img", { name: "Unread agent messages" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Agent working" })).not.toBeInTheDocument();

    rerender(<SidebarStatusIndicator {...props} liveStatus="idle" isUnread={false} />);
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
            featureId={42}
            liveStatus="question"
            isActive={false}
            isUnread
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
    render(
      <SidebarStatusIndicator
        featureId={42}
        liveStatus="question"
        isActive
        isUnread={false}
        onOpenConversation={vi.fn()}
      />,
    );
    expect(gate.usePopoverOpen).toHaveBeenCalledWith(42, false);
  });
});
