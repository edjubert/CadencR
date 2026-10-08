import { describe, it, expect, beforeEach, vi } from "vitest";
import { useState, type ReactElement } from "react";
import userEvent from "@testing-library/user-event";
import { fireEvent, render, screen, waitFor } from "@/test-utils";
import { ArchiveFeatureDialog } from "./ArchiveFeatureDialog";
import type { Feature, GitStatusSnapshot } from "@/api/generated";

const {
  mockDeleteWorktree,
  mockDeleteBranch,
  mockBranchCheck,
  mockGitStatus,
  mockKillTerminals,
  mockListFeatureActivity,
  mockArchivePreview,
} = vi.hoisted(() => ({
  mockDeleteWorktree: vi.fn(),
  mockDeleteBranch: vi.fn(),
  mockBranchCheck: vi.fn(),
  mockGitStatus: vi.fn(),
  mockKillTerminals: vi.fn(),
  mockListFeatureActivity: vi.fn(),
  mockArchivePreview: vi.fn(),
}));

vi.mock("@/api/generated", () => ({
  useDeleteWorktree: vi.fn(() => ({ mutateAsync: mockDeleteWorktree })),
  useDeleteFeatureBranch: vi.fn(() => ({ mutateAsync: mockDeleteBranch })),
  useCheckBranchDelete: mockBranchCheck,
  useGetGitStatus: mockGitStatus,
  useKillTerminalSessions: vi.fn(() => ({ mutateAsync: mockKillTerminals })),
  useListFeatureActivity: mockListFeatureActivity,
  useGetFeatureArchivePreview: mockArchivePreview,
}));

vi.mock("sonner", () => ({
  toast: {
    promise: vi.fn((promise: Promise<unknown>) => {
      void promise.catch(() => undefined);
      return promise;
    }),
    error: vi.fn(),
  },
}));

const feature: Feature = {
  id: 1,
  title: "Feature One",
  status: "active",
  type: "ws-session",
  project_id: 1,
  is_pinned: false,
  created_at: "2026-01-01T00:00:00Z",
};

const nextFeature: Feature = {
  ...feature,
  id: 2,
  title: "Feature Two",
  created_at: "2026-01-02T00:00:00Z",
};

function dirtyStatus(overrides: Partial<GitStatusSnapshot> = {}): GitStatusSnapshot {
  return {
    feature_id: 1,
    current_branch: "feature/one",
    target_branch: "main",
    uncommitted_count: 2,
    staged_count: 0,
    unstaged_count: 1,
    untracked_count: 1,
    ahead_of_remote: 0,
    behind_remote: 0,
    ahead_of_target: 0,
    has_remote: true,
    shared_with: [],
    computed_at: 1,
    ...overrides,
  };
}

function renderDialog(
  overrides: {
    hasLiveWorktree?: boolean;
    hasResidualWorktreeDirectory?: boolean;
    showWorktreeRemoval?: boolean;
    showBranchRemoval?: boolean;
  } = {},
) {
  const onArchive = vi.fn().mockResolvedValue({ archived_ids: [feature.id] });
  const onOpenChange = vi.fn();
  const view = render(
    <ArchiveFeatureDialog
      open
      feature={feature}
      projectId={1}
      hasLiveWorktree={overrides.hasLiveWorktree ?? false}
      hasResidualWorktreeDirectory={overrides.hasResidualWorktreeDirectory ?? false}
      showWorktreeRemoval={overrides.showWorktreeRemoval ?? true}
      showBranchRemoval={overrides.showBranchRemoval ?? true}
      onOpenChange={onOpenChange}
      onArchive={onArchive}
    />,
  );
  return { onArchive, onOpenChange, ...view };
}

describe("ArchiveFeatureDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteWorktree.mockResolvedValue({ success: true });
    mockDeleteBranch.mockResolvedValue({ success: true });
    mockBranchCheck.mockReturnValue({
      data: {
        branch: "feature/one",
        current_branch: "feature/one",
        target_branch: "main",
        merged: true,
      },
      isLoading: false,
    });
    mockGitStatus.mockReturnValue({ data: undefined, isLoading: false });
    mockKillTerminals.mockResolvedValue({ killed: 0 });
    mockListFeatureActivity.mockReturnValue({ data: [] });
    mockArchivePreview.mockReturnValue({
      data: { parent_ids: [], descendant_ids: [] },
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  function withRunningShells(count: number): void {
    mockListFeatureActivity.mockReturnValue({
      data: [{ feature_id: 1, shell_count: count }],
    });
  }

  it("uses Cmd+Enter, not plain Enter, to confirm archiving", async () => {
    const user = userEvent.setup();
    const { onArchive } = renderDialog();

    await user.keyboard("{Enter}");

    expect(onArchive).not.toHaveBeenCalled();

    await user.keyboard("{Meta>}{Enter}{/Meta}");

    await waitFor(() =>
      expect(onArchive).toHaveBeenCalledWith(1, {
        include_parent: false,
        include_descendants: false,
      }),
    );
  });

  it("ignores repeated confirm keys while the archive dialog is closing", async () => {
    const user = userEvent.setup();
    const onArchive = vi.fn().mockResolvedValue({ archived_ids: [1] });

    function DelayedCloseHarness(): ReactElement {
      const [dialogFeature, setDialogFeature] = useState(feature);
      return (
        <ArchiveFeatureDialog
          open
          feature={dialogFeature}
          projectId={1}
          hasLiveWorktree={false}
          hasResidualWorktreeDirectory={false}
          showWorktreeRemoval
          showBranchRemoval
          onOpenChange={vi.fn()}
          onArchive={async (featureId, options) => {
            onArchive(featureId, options);
            setDialogFeature(nextFeature);
          }}
        />
      );
    }

    render(<DelayedCloseHarness />);

    screen.getByRole("button", { name: /archive/i }).focus();
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await user.keyboard("{Enter}");

    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(onArchive).toHaveBeenCalledWith(1, {
      include_parent: false,
      include_descendants: false,
    });
  });

  it.each([
    { parent: false, descendants: false },
    { parent: true, descendants: false },
    { parent: false, descendants: true },
    { parent: true, descendants: true },
  ])("submits independent linked-session choices: $parent/$descendants", async (choice) => {
    mockArchivePreview.mockReturnValue({
      data: { parent_ids: [8], descendant_ids: [9, 10] },
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    const user = userEvent.setup();
    const { onArchive } = renderDialog();

    if (choice.parent) await user.click(screen.getByText("Archive parent"));
    if (choice.descendants) await user.click(screen.getByText("Archive 2 descendants"));
    await user.click(screen.getByRole("button", { name: /archive/i }));

    expect(onArchive).toHaveBeenCalledWith(1, {
      include_parent: choice.parent,
      include_descendants: choice.descendants,
    });
  });

  it("shows only eligible relative choices", () => {
    mockArchivePreview.mockReturnValue({
      data: { parent_ids: [], descendant_ids: [9] },
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderDialog();

    expect(screen.queryByText("Archive parent")).not.toBeInTheDocument();
    expect(screen.getByText("Archive 1 descendant")).toBeInTheDocument();
  });

  it("shows preview loading and an actionable error", async () => {
    const refetch = vi.fn();
    mockArchivePreview.mockReturnValueOnce({
      data: undefined,
      isFetching: true,
      error: null,
      refetch,
    });
    const { unmount } = renderDialog();
    expect(screen.getByText("Checking linked sessions…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /archive/i })).toBeDisabled();
    unmount();

    mockArchivePreview.mockReturnValue({
      data: undefined,
      isFetching: false,
      error: new Error("preview unavailable"),
      refetch,
    });
    const user = userEvent.setup();
    renderDialog();
    expect(screen.getByRole("alert")).toHaveTextContent("preview unavailable");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("uses layout-aware P and C mnemonics without modifiers", () => {
    mockArchivePreview.mockReturnValue({
      data: { parent_ids: [8], descendant_ids: [9] },
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderDialog();
    const dialog = screen.getByRole("dialog");

    fireEvent.keyDown(dialog, { key: "p", code: "KeyQ" });
    fireEvent.keyDown(dialog, { key: "c", code: "KeyC" });
    expect(screen.getByRole("checkbox", { name: /archive parent/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /archive 1 descendant/i })).toBeChecked();

    fireEvent.keyDown(dialog, { key: "p", code: "KeyP", metaKey: true });
    expect(screen.getByRole("checkbox", { name: /archive parent/i })).toBeChecked();
  });

  it("resets relative selections for a different feature", async () => {
    mockArchivePreview.mockReturnValue({
      data: { parent_ids: [8], descendant_ids: [] },
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    const user = userEvent.setup();
    const { rerender } = render(
      <ArchiveFeatureDialog
        open
        feature={feature}
        projectId={1}
        hasLiveWorktree={false}
        hasResidualWorktreeDirectory={false}
        showWorktreeRemoval={false}
        showBranchRemoval={false}
        onOpenChange={vi.fn()}
        onArchive={vi.fn().mockResolvedValue({ archived_ids: [] })}
      />,
    );
    await user.click(screen.getByText("Archive parent"));
    expect(screen.getByRole("checkbox", { name: /archive parent/i })).toBeChecked();
    rerender(
      <ArchiveFeatureDialog
        open
        feature={nextFeature}
        projectId={1}
        hasLiveWorktree={false}
        hasResidualWorktreeDirectory={false}
        showWorktreeRemoval={false}
        showBranchRemoval={false}
        onOpenChange={vi.fn()}
        onArchive={vi.fn().mockResolvedValue({ archived_ids: [] })}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: /archive parent/i })).not.toBeChecked(),
    );
  });

  it("waits for archive success before closing and cleanup", async () => {
    let resolveArchive!: (value: unknown) => void;
    const onArchive = vi.fn(() => new Promise((resolve) => (resolveArchive = resolve)));
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ArchiveFeatureDialog
        open
        feature={feature}
        projectId={1}
        hasLiveWorktree={false}
        hasResidualWorktreeDirectory={false}
        showWorktreeRemoval
        showBranchRemoval={false}
        onOpenChange={onOpenChange}
        onArchive={onArchive}
      />,
    );
    await user.click(screen.getByText("Remove worktree"));
    await user.click(screen.getByRole("button", { name: /archive/i }));
    expect(screen.getByRole("button", { name: "Archiving…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(mockDeleteWorktree).not.toHaveBeenCalled();
    resolveArchive({ archived_ids: [1] });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    await waitFor(() => expect(mockDeleteWorktree).toHaveBeenCalledOnce());
  });

  it("keeps the dialog open and skips cleanup when archiving fails", async () => {
    const onArchive = vi.fn().mockRejectedValue(new Error("archive refused"));
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ArchiveFeatureDialog
        open
        feature={feature}
        projectId={1}
        hasLiveWorktree={false}
        hasResidualWorktreeDirectory={false}
        showWorktreeRemoval
        showBranchRemoval={false}
        onOpenChange={onOpenChange}
        onArchive={onArchive}
      />,
    );
    await user.click(screen.getByText("Remove worktree"));
    await user.click(screen.getByRole("button", { name: /archive/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("archive refused");
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(mockDeleteWorktree).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /archive/i })).toBeEnabled();
  });

  it("hides the kill-terminals option when the feature has no live shells", () => {
    renderDialog();
    expect(screen.queryByText("Kill terminals")).not.toBeInTheDocument();
  });

  it("kills running terminals via the T shortcut when archiving", async () => {
    withRunningShells(2);
    const user = userEvent.setup();
    renderDialog();

    expect(screen.getByText(/Stop the 2 running shells/i)).toBeInTheDocument();

    await user.keyboard("t");
    await user.click(screen.getByRole("button", { name: /archive/i }));

    expect(mockKillTerminals).toHaveBeenCalledWith({ params: { feature_id: 1 } });
  });

  it("does not kill terminals when the option is left unchecked", async () => {
    withRunningShells(1);
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: /archive/i }));

    expect(mockKillTerminals).not.toHaveBeenCalled();
  });

  it("warns and force-removes dirty worktrees", async () => {
    mockGitStatus.mockReturnValue({ data: dirtyStatus(), isLoading: false });
    const user = userEvent.setup();
    renderDialog({ hasLiveWorktree: true });

    await user.click(screen.getByText("Remove worktree"));

    expect(screen.getByText(/permanently lose local changes/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /archive/i }));

    expect(mockDeleteWorktree).toHaveBeenCalledWith({
      params: { project_id: 1, feature_id: 1, force: true },
    });
  });

  it("force-removes residual files from an invalid worktree folder", async () => {
    const user = userEvent.setup();
    renderDialog({ hasResidualWorktreeDirectory: true });

    await user.click(screen.getByText("Remove worktree"));

    expect(screen.getByText(/Git no longer recognizes this worktree/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /archive/i }));
    expect(mockDeleteWorktree).toHaveBeenCalledWith({
      params: { project_id: 1, feature_id: 1, force: true },
    });
  });

  it("removes stale worktree metadata before deleting its branch", async () => {
    const user = userEvent.setup();
    renderDialog({ hasLiveWorktree: false });

    await user.click(screen.getByText("Remove branch"));

    expect(screen.getByRole("checkbox", { name: /remove worktree/i })).toBeChecked();
    await user.click(screen.getByRole("button", { name: /archive/i }));
    await waitFor(() => expect(mockDeleteWorktree).toHaveBeenCalledTimes(1));
    expect(mockDeleteBranch).toHaveBeenCalledTimes(1);
  });

  it("still attempts branch deletion when worktree cleanup reports an error", async () => {
    mockDeleteWorktree.mockResolvedValue({ success: false, error: "directory not empty" });
    const user = userEvent.setup();
    renderDialog({ hasLiveWorktree: true });

    await user.click(screen.getByText("Remove branch"));
    await user.click(screen.getByRole("button", { name: /archive/i }));

    await waitFor(() => expect(mockDeleteBranch).toHaveBeenCalledTimes(1));
  });

  it("does not allow branch removal when a no-worktree session is on the target branch", async () => {
    mockBranchCheck.mockReturnValue({
      data: { branch: "main", current_branch: "main", target_branch: "main", merged: true },
      isLoading: false,
    });
    const user = userEvent.setup();
    renderDialog({ showWorktreeRemoval: false });

    await user.click(screen.getByText("Remove branch"));

    expect(screen.getByRole("checkbox", { name: /remove branch/i })).not.toBeChecked();
    expect(screen.getByText(/cannot remove the target branch/i)).toBeInTheDocument();
  });

  it("explains no-worktree branch removal checks out the target before deleting", async () => {
    const user = userEvent.setup();
    renderDialog({ showWorktreeRemoval: false });

    await user.click(screen.getByText("Remove branch"));

    expect(screen.getByRole("checkbox", { name: /remove branch/i })).toBeChecked();
    expect(screen.getByText(/checkout main before deleting feature\/one/i)).toBeInTheDocument();
  });

  it("does not allow removing the default branch", async () => {
    mockBranchCheck.mockReturnValue({
      data: {
        branch: "main",
        current_branch: "feature/one",
        target_branch: "develop",
        default_branch: "main",
        is_default_branch: true,
        merged: true,
      },
      isLoading: false,
    });
    const user = userEvent.setup();
    renderDialog({ showWorktreeRemoval: false });

    await user.click(screen.getByText("Remove branch"));

    expect(screen.getByRole("checkbox", { name: /remove branch/i })).not.toBeChecked();
    expect(screen.getByText(/cannot remove the default branch/i)).toBeInTheDocument();
  });

  it("shows only archive confirmation when branch and worktree cleanup are unavailable", () => {
    renderDialog({ showWorktreeRemoval: false, showBranchRemoval: false });

    expect(screen.queryByText("Remove worktree")).not.toBeInTheDocument();
    expect(screen.queryByText("Remove branch")).not.toBeInTheDocument();
    expect(mockBranchCheck).toHaveBeenCalledWith(
      { project_id: 1, feature_id: 1 },
      { query: { enabled: false, retry: false } },
    );
  });
});
