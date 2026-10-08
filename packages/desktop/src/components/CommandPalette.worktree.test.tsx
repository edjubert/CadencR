import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@/test-utils";
import type { SettingEntry } from "@/api/settings";
import { CommandPalette } from "./CommandPalette";

// Mutable holder so the test can flip the project-settings query result mid-run
// to simulate the async settle (undefined -> loaded "skip" default) that used
// to clobber the user's reuse+branch selection.
const state = vi.hoisted(() => ({
  projectSettings: undefined as SettingEntry[] | undefined,
  createFeature: vi.fn(),
  setProjectSetting: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@/lib/desktop-bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/desktop-bridge")>();
  return {
    ...actual,
    desktopBridge: { ...actual.desktopBridge, pickDirectory: vi.fn() },
  };
});

vi.mock("../api/generated", () => ({
  useListProjects: () => ({ data: [{ id: 1, name: "Proj" }] }),
  useCreateProject: () => ({ mutate: vi.fn() }),
  useCreateFeature: () => ({ mutate: state.createFeature }),
  useGetProjectSettings: () => ({ data: state.projectSettings }),
  useSetProjectSetting: () => ({ mutate: state.setProjectSetting, mutateAsync: vi.fn() }),
  getListProjectsQueryKey: () => ["projects"],
  getListFeaturesQueryKey: () => ["features"],
  useListFeatures: () => ({ data: [] }),
  useListBranches: () => ({
    data: [
      { name: "main", is_local: true, attached_worktree_path: null, attached_feature_id: null },
      {
        name: "feat/attached",
        is_local: true,
        attached_worktree_path: "/tmp/wt",
        attached_feature_id: 9,
      },
    ],
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

describe("CommandPalette worktree step", () => {
  beforeEach(() => {
    state.projectSettings = undefined;
    state.createFeature.mockClear();
    state.setProjectSetting.mockClear();
  });

  it("keeps the reuse branch selection when project settings settle to a different default", async () => {
    const { user, rerender } = render(
      <CommandPalette open onOpenChange={vi.fn()} activeProjectId={1} activeFeatureId={null} />,
    );

    // Enter the worktree step for the active project.
    await user.click(screen.getByText("New Feature"));

    // Pick "Reuse existing branch" then the branch that already has a worktree.
    await user.click(screen.getByText("Reuse existing branch"));
    await user.click(await screen.findByText("feat/attached"));

    // The project-settings query now settles with a "skip" default. This used
    // to re-fire the seed effect and wipe the selection back to { mode: "skip" }.
    state.projectSettings = [{ key: "default_worktree_mode", value: "skip" }];
    rerender(
      <CommandPalette open onOpenChange={vi.fn()} activeProjectId={1} activeFeatureId={null} />,
    );

    await user.click(screen.getByRole("button", { name: /create feature/i }));

    await waitFor(() => expect(state.createFeature).toHaveBeenCalledTimes(1));
    expect(state.createFeature.mock.calls[0][0]).toEqual({
      data: {
        project_id: 1,
        title: "Untitled Feature",
        worktree_mode: "reuse",
        reuse_branch: "feat/attached",
      },
    });
  });

  it("still seeds the step with the project's saved default when untouched", async () => {
    state.projectSettings = [{ key: "default_worktree_mode", value: "skip" }];
    const { user } = render(
      <CommandPalette open onOpenChange={vi.fn()} activeProjectId={1} activeFeatureId={null} />,
    );

    // Enter the step and confirm without picking anything — the guard must not
    // block the seed effect from applying the saved "skip" default.
    await user.click(screen.getByText("New Feature"));
    await user.click(screen.getByRole("button", { name: /create feature/i }));

    await waitFor(() => expect(state.createFeature).toHaveBeenCalledTimes(1));
    expect(state.createFeature.mock.calls[0][0]).toEqual({
      data: { project_id: 1, title: "Untitled Feature", worktree_mode: "skip" },
    });
  });
});
