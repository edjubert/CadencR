import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@/test-utils";
import type { Feature } from "@/api/generated";
import { ShortcutHintsProvider } from "@/hooks/useNavShortcutHints";
import { PLATFORM_IS_MAC } from "@/lib/shortcuts/format";
import { PinnedConversationRow } from "./PinnedConversationRow";

const mocks = vi.hoisted(() => ({ title: { title: null as string | null, isAutoNaming: false } }));
beforeEach(() => {
  mocks.title = { title: null, isAutoNaming: false };
});

vi.mock("@/components/ProjectBadge", () => ({ ProjectBadge: () => <span>Project</span> }));
vi.mock("@/hooks/useFeaturePrefetch", () => ({ useFeaturePrefetch: () => vi.fn() }));
vi.mock("@/hooks/useFeatureTitle", () => ({
  useFeatureTitle: () => mocks.title,
}));
vi.mock("@/components/ShortcutTooltip", () => ({
  ShortcutTooltip: ({ children }: { children: unknown }) => children,
}));

const feature = {
  id: 42,
  project_id: 1,
  title: "Pinned conversation",
  runtime_provider: "codex_cli",
} as Feature;

describe("pinned sidebar identity", () => {
  it("uses the trailing logo/number slot and the same modifier navigation", () => {
    const onNavigate = vi.fn();
    render(
      <ShortcutHintsProvider enabled>
        <PinnedConversationRow
          feature={feature}
          activeFeatureId={null}
          onNavigate={onNavigate}
          onUnpin={vi.fn()}
        />
      </ShortcutHintsProvider>,
    );
    const row = screen.getByRole("button", { name: /Pinned conversation/ });
    const titleLine = row.querySelector("[data-feature-title-line]");
    expect(titleLine?.lastElementChild).toHaveAttribute("data-sidebar-identity-slot");
    expect(screen.getByLabelText("Agent idle")).toBeInTheDocument();
    const modifier = PLATFORM_IS_MAC ? { metaKey: true } : { ctrlKey: true };
    fireEvent.keyDown(window, { key: PLATFORM_IS_MAC ? "Meta" : "Control", ...modifier });
    expect(row.querySelector("[data-nav-shortcut-badge]")).toHaveAttribute("data-visible", "true");
    fireEvent.keyDown(window, { key: "1", ...modifier });
    expect(onNavigate).toHaveBeenCalledWith(feature);
  });
});

function renderRow(activeFeatureId: number | null = null) {
  const onNavigate = vi.fn();
  const onUnpin = vi.fn();
  const view = render(
    <PinnedConversationRow
      feature={feature}
      activeFeatureId={activeFeatureId}
      onNavigate={onNavigate}
      onUnpin={onUnpin}
    />,
  );
  return { ...view, onNavigate, onUnpin };
}

describe("PinnedConversationRow", () => {
  it("falls back to the REST title when no live title has arrived", () => {
    renderRow();
    expect(screen.getByText("Pinned conversation")).toBeInTheDocument();
  });
  it("prefers the live WS-pushed title when present", () => {
    mocks.title = { title: "Live Title", isAutoNaming: false };
    renderRow();
    expect(screen.getByText("Live Title")).toBeInTheDocument();
    expect(screen.queryByText("Pinned conversation")).not.toBeInTheDocument();
  });
  it("shows a skeleton instead of the title while auto-naming", () => {
    mocks.title = { title: null, isAutoNaming: true };
    renderRow();
    expect(screen.queryByText("Pinned conversation")).not.toBeInTheDocument();
  });
  it("navigates on row click", async () => {
    const { user, onNavigate } = renderRow();
    await user.click(screen.getByText("Pinned conversation"));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
  it("does not navigate when the row is already active", async () => {
    const { user, onNavigate } = renderRow(feature.id);
    await user.click(screen.getByText("Pinned conversation"));
    expect(onNavigate).not.toHaveBeenCalled();
  });
  it("unpins without navigating when the unpin button is clicked", async () => {
    const { user, onNavigate, onUnpin } = renderRow();
    await user.click(screen.getByRole("button", { name: "Unpin" }));
    expect(onUnpin).toHaveBeenCalledWith(feature.id);
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
