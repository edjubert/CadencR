import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test-utils";
import type { AllocatedPort, Feature, PrStatusSnapshot } from "@/api/generated";
import { FeatureRowMetaLine } from "./ProjectFeatureRowParts";

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

function renderLine(prStatus: PrStatusSnapshot | undefined, ports: readonly AllocatedPort[] = []) {
  return render(
    <FeatureRowMetaLine
      feature={feature()}
      prStatus={prStatus}
      gitStats={undefined}
      shellCount={0}
      browserCount={0}
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
});
