import { memo } from "react";
import type { AgentBlockData } from "@/components/AgentBlock";
import { CompactToolTile } from "./CompactToolTile";

interface CompactFlowRowProps {
  blocks: AgentBlockData[];
  basePath?: string;
}

function sameCompactFlowRow(previous: CompactFlowRowProps, next: CompactFlowRowProps): boolean {
  if (previous.basePath !== next.basePath || previous.blocks.length !== next.blocks.length) {
    return false;
  }
  return previous.blocks.every((block, index) => block === next.blocks[index]);
}

/**
 * Renders one bounded chunk of consecutive non-text blocks as a flex-wrap of
 * tiles (the "Compact flow" verbosity mode). `buildDisplayItems` owns the
 * chunk bound so the outer stream virtualizer can discard off-screen chunks.
 * Tiles remain content-sized, preserving the existing visual flow.
 */
export const CompactFlowRow = memo(function CompactFlowRow({
  blocks,
  basePath,
}: CompactFlowRowProps) {
  return (
    <div className="my-1 flex flex-wrap items-center gap-1.5 py-0.5">
      {blocks.map((block) => (
        // `display: contents` keeps the flex layout identical while giving the
        // search highlighter a per-block anchor for active-match resolution.
        <div key={block.id} data-block-id={block.id} className="contents">
          <CompactToolTile block={block} basePath={basePath} />
        </div>
      ))}
    </div>
  );
}, sameCompactFlowRow);
