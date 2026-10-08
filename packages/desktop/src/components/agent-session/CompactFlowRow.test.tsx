import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AgentBlockData } from "@/components/AgentBlock";
import { buildDisplayItems, MAX_COMPACT_FLOW_BLOCKS } from "@/components/agentStreamDisplay";

const tileRenders = vi.hoisted(() => new Map<string, number>());
vi.mock("./CompactToolTile", () => ({
  CompactToolTile: ({ block }: { block: AgentBlockData }) => {
    tileRenders.set(block.id, (tileRenders.get(block.id) ?? 0) + 1);
    return <span>{block.id}</span>;
  },
}));

const { CompactFlowRow } = await import("./CompactFlowRow");

function tools(count: number): AgentBlockData[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `tool-${index}`,
    type: "tool_call" as const,
    content: "",
    toolName: "Read",
  }));
}

describe("CompactFlowRow", () => {
  it("does not rerender a settled chunk when a tail append starts the next row", () => {
    tileRenders.clear();
    const blocks = tools(MAX_COMPACT_FLOW_BLOCKS + 1);
    const before = buildDisplayItems(blocks.slice(0, -1), { compact: true });
    const after = buildDisplayItems(blocks, { compact: true });
    const beforeFlow = before[0];
    const afterFlow = after[0];
    if (beforeFlow.kind !== "flow" || afterFlow.kind !== "flow") {
      throw new Error("expected compact flow rows");
    }
    const { rerender } = render(<CompactFlowRow blocks={beforeFlow.blocks} basePath="/repo" />);
    expect([...tileRenders.values()]).toEqual(
      Array.from({ length: MAX_COMPACT_FLOW_BLOCKS }, () => 1),
    );

    rerender(<CompactFlowRow blocks={afterFlow.blocks} basePath="/repo" />);

    expect([...tileRenders.values()]).toEqual(
      Array.from({ length: MAX_COMPACT_FLOW_BLOCKS }, () => 1),
    );
  });

  it("rerenders when path-dependent tile presentation changes", () => {
    tileRenders.clear();
    const blocks = tools(1);
    const { rerender } = render(<CompactFlowRow blocks={blocks} basePath="/first" />);

    rerender(<CompactFlowRow blocks={[...blocks]} basePath="/second" />);

    expect(tileRenders.get("tool-0")).toBe(2);
  });
});
