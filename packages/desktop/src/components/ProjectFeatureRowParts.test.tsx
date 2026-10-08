import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test-utils";
import type { AllocatedPort, Feature, PrStatusSnapshot } from "@/api/generated";
import { FeatureRowMetaLine, FeatureRowTitleLine } from "./ProjectFeatureRowParts";

vi.mock("@/components/ShortcutTooltip", () => ({
  ShortcutTooltip: ({ children }: { children: unknown }) => children,
}));

vi.mock("@/components/SidebarPendingGatePopover", () => ({
  SidebarPendingGatePopover: () => <div data-testid="pending-gate">default-gate</div>,
}));

function feature(overrides: Partial<Feature> = {}): Feature {
  return {
    id: 5,
    project_id: 1,
    title: "A feature",
    status: "active",
    type: "ws-session",
    label: null,
    is_pinned: false,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    ...overrides,
  } as Feature;
}

function snapshot(overrides: Partial<PrStatusSnapshot> = {}): PrStatusSnapshot {
  return {
    setup_required: false,
    feature_id: 5,
    fetched_at: 1,
    error: null,
    ci: { state: "none", checks: [] },
    pr: null,
    ...overrides,
  };
}

function port(overrides: Partial<AllocatedPort> = {}): AllocatedPort {
  return {
    port: 3000,
    pid: 999,
    process: "node",
    source: "agent",
    ...overrides,
  };
}

function renderLine(
  prStatus: PrStatusSnapshot | undefined,
  ports: readonly AllocatedPort[] = [],
  downloadCount = 0,
) {
  return render(
    <FeatureRowMetaLine
      feature={feature()}
      prStatus={prStatus}
      gitStats={undefined}
      shellCount={0}
      browserCount={0}
      downloadCount={downloadCount}
      ports={ports}
      isEditingLabel={false}
      labelDraft=""
      labelSuggestions={[]}
      isSavingLabel={false}
      onLabelDraftChange={vi.fn()}
      onSaveLabel={vi.fn()}
      onCancelLabelEdit={vi.fn()}
      onOpenPort={vi.fn()}
    />,
  );
}

describe("FeatureRowMetaLine", () => {
  it("stays a single line when the row has nothing to show", () => {
    renderLine(undefined);

    expect(document.querySelector("[data-feature-meta-line]")).toBeNull();
  });

  it("mounts for a forge error even with no proposal, so it can't be swallowed", () => {
    renderLine(snapshot({ error: "Bad credentials" }));

    expect(document.querySelector("[data-feature-meta-line]")).not.toBeNull();
    expect(screen.getByLabelText("Forge status error: Bad credentials")).toBeInTheDocument();
  });

  it("stays hidden for a clean snapshot with neither proposal nor error", () => {
    renderLine(snapshot());

    expect(document.querySelector("[data-feature-meta-line]")).toBeNull();
  });

  it("mounts for an allocated port even when the row has nothing else to show", () => {
    renderLine(undefined, [port()]);

    expect(document.querySelector("[data-feature-meta-line]")).not.toBeNull();
    expect(screen.getByLabelText("Port 3000 in use")).toBeInTheDocument();
  });

  it("summarises several ports on one badge", () => {
    renderLine(undefined, [port(), port({ port: 5173, pid: 1000 })]);

    expect(screen.getByLabelText("Ports 3000, 5173 in use")).toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
  });

  it("shows active downloads independently from browser tabs", () => {
    renderLine(undefined, [], 2);

    expect(screen.getByLabelText("2 browser downloads active")).toHaveTextContent("2");
    expect(screen.queryByLabelText(/browser tabs open/)).not.toBeInTheDocument();
  });
});

describe("FeatureRowTitleLine", () => {
  const row = (status: "idle" | "agent" | "question", unread = false) =>
    render(
      <FeatureRowTitleLine
        feature={feature({ runtime_provider: "codex_cli" })}
        liveTitle={undefined}
        isAutoNaming={false}
        isArchived={false}
        hasWorktree={false}
        liveStatus={status}
        isActive={false}
        isUnread={unread}
        onOpenConversation={vi.fn()}
      />,
    );

  it("puts the quiet logo at the very end of the title line", () => {
    row("idle");
    const line = document.querySelector("[data-feature-title-line]");
    expect(line).toHaveClass("min-h-6");
    expect(line?.firstElementChild).toHaveAttribute("data-sidebar-status", "idle");
    expect(line?.lastElementChild).toHaveAttribute("data-sidebar-identity-slot");
    expect(line?.lastElementChild?.querySelector("[data-provider-mark]")).toHaveAttribute(
      "data-provider-mark",
      "mono",
    );
    expect(screen.getByText("A feature")).toHaveClass("truncate", "flex-1");
  });

  it("shows working separately without tinting the logo", () => {
    row("agent", true);
    expect(screen.getByLabelText("Agent working")).toHaveClass("sidebar-status-working");
    expect(screen.getByRole("img", { name: /Codex/ })).toHaveClass("text-muted-foreground");
    expect(screen.queryByLabelText("Unread agent messages")).not.toBeInTheDocument();
  });

  it("keeps unread distinct from working", () => {
    row("idle", true);
    expect(screen.getByLabelText("Unread agent messages")).toHaveClass("sidebar-status-unread");
    expect(screen.queryByLabelText("Agent working")).not.toBeInTheDocument();
  });

  it("keeps the pending gate independent of the provider", () => {
    row("question");
    expect(screen.getByTestId("pending-gate")).toHaveTextContent("default-gate");
    expect(screen.getByTestId("pending-gate").querySelector("[data-provider-mark]")).toBeNull();
    expect(screen.getByRole("img", { name: /Codex/ })).toBeInTheDocument();
  });
});
