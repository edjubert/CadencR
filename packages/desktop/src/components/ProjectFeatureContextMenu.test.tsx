import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@/test-utils";
import type { Feature, PrSummary } from "@/api/generated";
import { ContextMenu, ContextMenuContent } from "@/components/ui/context-menu";
import { ProjectFeatureContextMenu } from "./ProjectFeatureContextMenu";

const openExternal = vi.fn((_url: string) => Promise.resolve());
vi.mock("@/lib/desktop-bridge", () => ({
  desktopBridge: {
    openExternal: (url: string) => openExternal(url),
  },
}));

const feature = { id: 7, title: "Ship it" } as Feature;

function pullRequest(overrides: Partial<PrSummary> = {}): PrSummary {
  return {
    author: { username: "reviewer" },
    body_markdown: "",
    head_sha: "abc",
    number: 42,
    pr_label: "Pull request",
    review_state: "approved",
    source_branch: "feature/ship-it",
    state: "open",
    target_branch: "main",
    title: "Ship it",
    updated_at: "2026-07-24T00:00:00Z",
    url: "https://example.test/pr/42",
    ...overrides,
  };
}

function renderMenu(pr: PrSummary | null): void {
  render(
    <ContextMenu open>
      <ContextMenuContent>
        <ProjectFeatureContextMenu
          feature={feature}
          liveTitle={undefined}
          worktree={undefined}
          pullRequest={pr}
          isArchived={false}
          isPinned={false}
          hasActivity={false}
          shellCount={0}
          browserCount={0}
          downloadCount={0}
          onNavigate={vi.fn()}
          onTogglePin={vi.fn()}
          onStartLabelEditAfterMenuClose={vi.fn()}
          onCloseActivity={vi.fn()}
          onUnarchive={vi.fn()}
          onArchiveOrDelete={vi.fn()}
        />
      </ContextMenuContent>
    </ContextMenu>,
  );
}

describe("ProjectFeatureContextMenu", () => {
  beforeEach(() => openExternal.mockClear());

  it("opens the proposal on its host using the provider's own noun", () => {
    renderMenu(pullRequest());

    fireEvent.click(screen.getByText("Open pull request #42"));

    expect(openExternal).toHaveBeenCalledWith("https://example.test/pr/42");
  });

  it("uses the merge-request noun on GitLab remotes", () => {
    renderMenu(pullRequest({ pr_label: "Merge request", number: 9 }));

    expect(screen.getByText("Open merge request #9")).toBeInTheDocument();
  });

  it("omits the action when the feature's branch has no proposal", () => {
    renderMenu(null);

    expect(screen.queryByText(/^Open (pull|merge) request/)).not.toBeInTheDocument();
  });
});
