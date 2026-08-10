import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { act, render, screen } from "@/test-utils";
import type { ReferencedWorktreeSelection } from "./agent-prompt-bar-types";
import { serializeConversationReference } from "./prompt-editor/conversation-reference";
import { ReferencedWorktreeTip } from "./ReferencedWorktreeTip";

const mocks = vi.hoisted(() => ({
  useListFeatureWorktrees: vi.fn(),
  useScopedShortcut: vi.fn(),
}));

vi.mock("@/api/generated", () => ({
  useListFeatureWorktrees: mocks.useListFeatureWorktrees,
}));

vi.mock("@/hooks/useShortcut", () => ({
  useScopedShortcut: mocks.useScopedShortcut,
}));

function reference(featureId: number, label: string): string {
  return serializeConversationReference({ featureId, label });
}

function selection(
  overrides: Partial<ReferencedWorktreeSelection> = {},
): ReferencedWorktreeSelection {
  return {
    mode: "on_branch",
    selectedBranch: null,
    onSelect: vi.fn(),
    ...overrides,
  };
}

function renderTip(
  prompt: string,
  worktreeSelection: ReferencedWorktreeSelection = selection(),
): ReturnType<typeof render> {
  return render(
    <ReferencedWorktreeTip
      prompt={prompt}
      projectId={3}
      selection={worktreeSelection}
      agentTabActive
      shortcutsDisabled={false}
    />,
  );
}

describe("ReferencedWorktreeTip", () => {
  beforeEach(() => {
    mocks.useListFeatureWorktrees.mockReset();
    mocks.useScopedShortcut.mockReset();
    mocks.useListFeatureWorktrees.mockReturnValue({
      data: [],
      error: null,
      isError: false,
      isLoading: false,
    });
  });

  it("loads worktree metadata only after a conversation reference is present", () => {
    const { rerender } = render(
      <ReferencedWorktreeTip
        prompt="ordinary first prompt"
        projectId={3}
        selection={selection()}
        agentTabActive
        shortcutsDisabled={false}
      />,
    );
    expect(mocks.useListFeatureWorktrees).toHaveBeenLastCalledWith(
      { project_id: 3 },
      { query: { enabled: false } },
    );

    rerender(
      <ReferencedWorktreeTip
        prompt={reference(17, "API work")}
        projectId={3}
        selection={selection()}
        agentTabActive
        shortcutsDisabled={false}
      />,
    );
    expect(mocks.useListFeatureWorktrees).toHaveBeenLastCalledWith(
      { project_id: 3 },
      { query: { enabled: true } },
    );
    expect(mocks.useScopedShortcut).toHaveBeenLastCalledWith(
      "agent-use-referenced-worktree",
      expect.any(Function),
      "agent",
      expect.objectContaining({ enabled: false }),
    );
  });

  it("offers the first live worktree referenced by the prompt", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    mocks.useListFeatureWorktrees.mockReturnValue({
      data: [
        {
          branch: "feature/auth",
          directory_exists: true,
          feature_id: 22,
          is_default_branch: false,
          is_main_worktree: false,
          live: true,
          worktree_branch: "feature/auth",
          worktree_path: "/repo/worktrees/auth",
        },
      ],
      error: null,
      isError: false,
      isLoading: false,
    });

    renderTip(
      `${reference(21, "No worktree")} and ${reference(22, "Auth conversation")}`,
      selection({ onSelect }),
    );

    const action = screen.getByRole("button", {
      name: "Reuse feature/auth worktree from Auth conversation when you send",
    });
    expect(action).toHaveTextContent(/Reuse feature\/auth from Auth conversation when you send/);
    expect(action).toHaveTextContent("Reuse worktree");
    expect(action).toHaveAttribute(
      "title",
      "Reuse /repo/worktrees/auth when you send your first message",
    );

    await user.click(action);
    expect(onSelect).toHaveBeenCalledWith("feature/auth");
  });

  it("applies the tip through its registered keyboard shortcut", () => {
    const onSelect = vi.fn();
    mocks.useListFeatureWorktrees.mockReturnValue({
      data: [
        {
          branch: "feature/auth",
          directory_exists: true,
          feature_id: 22,
          is_default_branch: false,
          is_main_worktree: false,
          live: true,
          worktree_branch: "feature/auth",
          worktree_path: "/repo/worktrees/auth",
        },
      ],
      error: null,
      isError: false,
      isLoading: false,
    });
    renderTip(reference(22, "Auth conversation"), selection({ onSelect }));
    const shortcutCall = mocks.useScopedShortcut.mock.calls.at(-1);
    expect(shortcutCall?.[0]).toBe("agent-use-referenced-worktree");
    expect(shortcutCall?.[2]).toBe("agent");
    expect(shortcutCall?.[3]).toMatchObject({ enabled: true });

    const preventDefault = vi.fn();
    const handler = shortcutCall?.[1] as
      | ((event: { preventDefault: () => void }) => void)
      | undefined;
    act(() => handler?.({ preventDefault }));

    expect(preventDefault).toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledWith("feature/auth");
  });

  it("ignores stale and main worktrees and hides once the referenced branch is selected", () => {
    mocks.useListFeatureWorktrees.mockReturnValue({
      data: [
        {
          branch: "feature/auth",
          directory_exists: true,
          feature_id: 22,
          is_default_branch: false,
          is_main_worktree: false,
          live: false,
          worktree_branch: "feature/auth",
          worktree_path: "/repo/worktrees/auth",
        },
        {
          branch: "main",
          directory_exists: true,
          feature_id: 23,
          is_default_branch: true,
          is_main_worktree: true,
          live: true,
          worktree_branch: "main",
          worktree_path: "/repo",
        },
      ],
      error: null,
      isError: false,
      isLoading: false,
    });
    const { rerender } = renderTip(
      `${reference(22, "Auth conversation")} ${reference(23, "Main checkout")}`,
    );
    expect(
      screen.queryByRole("button", { name: /Reuse .* worktree from .* when you send/ }),
    ).not.toBeInTheDocument();

    mocks.useListFeatureWorktrees.mockReturnValue({
      data: [
        {
          branch: "feature/auth",
          directory_exists: true,
          feature_id: 22,
          is_default_branch: false,
          is_main_worktree: false,
          live: true,
          worktree_branch: "feature/auth",
          worktree_path: "/repo/worktrees/auth",
        },
      ],
      error: null,
      isError: false,
      isLoading: false,
    });
    rerender(
      <ReferencedWorktreeTip
        prompt={reference(22, "Auth conversation")}
        projectId={3}
        selection={selection({ mode: "branch_worktree", selectedBranch: "feature/auth" })}
        agentTabActive
        shortcutsDisabled={false}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /Reuse .* worktree from .* when you send/ }),
    ).not.toBeInTheDocument();
  });

  it("shows progress and lookup failures above the prompt", () => {
    mocks.useListFeatureWorktrees.mockReturnValue({
      data: undefined,
      error: null,
      isError: false,
      isLoading: true,
    });
    const { rerender } = renderTip(reference(22, "Auth conversation"));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Checking the referenced conversation for a worktree",
    );

    mocks.useListFeatureWorktrees.mockReturnValue({
      data: undefined,
      error: new Error("offline"),
      isError: true,
      isLoading: false,
    });
    rerender(
      <ReferencedWorktreeTip
        prompt={reference(22, "Auth conversation")}
        projectId={3}
        selection={selection()}
        agentTabActive
        shortcutsDisabled={false}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("offline");
  });
});
