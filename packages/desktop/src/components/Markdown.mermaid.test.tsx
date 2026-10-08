import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@/test-utils";
import { Markdown } from "./Markdown";
import { __markdownCacheTestHelpers as cache } from "./markdown/markdown-tree-cache";

// Mock the lazy diagram so the heavy real `mermaid` module is never pulled into
// jsdom; we only need to assert which branch the streaming gate takes.
vi.mock("@/components/MermaidDiagram", () => ({
  default: ({ code }: { code: string }) => <div data-testid="mermaid-diagram">{code}</div>,
}));

const MERMAID = "```mermaid\ngraph TD\n  A-->B\n```";
// Same block mid-stream: the closing ``` fence has not arrived yet.
const MERMAID_STREAMING = "```mermaid\ngraph TD\n  A-->B";

describe("Markdown mermaid streaming gate", () => {
  beforeEach(() => cache.clear());
  it("renders a diagram for a stable, fully-fenced block (cacheKey set)", async () => {
    render(<Markdown content={MERMAID} cacheKey="stable-block" />);
    expect(await screen.findByTestId("mermaid-diagram")).toBeInTheDocument();
  });

  it("shows source (not a diagram) while the fence is still open, even with a cacheKey", () => {
    render(<Markdown content={MERMAID_STREAMING} cacheKey="streaming-block" isStreaming />);
    expect(screen.queryByTestId("mermaid-diagram")).not.toBeInTheDocument();
    expect(screen.getByText("mermaid")).toBeInTheDocument();
    expect(screen.getByText(/graph TD/)).toBeInTheDocument();
  });

  it("renders raw source while streaming (no cacheKey) instead of a diagram", () => {
    render(<Markdown content={MERMAID} />);
    expect(screen.queryByTestId("mermaid-diagram")).not.toBeInTheDocument();
    // Falls through to the normal code block: language label + source text.
    expect(screen.getByText("mermaid")).toBeInTheDocument();
    expect(screen.getByText(/graph TD/)).toBeInTheDocument();
  });

  it("does not let a cached settled tree observe later mutable content", async () => {
    const { rerender } = render(<Markdown content={MERMAID} cacheKey="reused-block" />);
    expect(await screen.findByTestId("mermaid-diagram")).toBeInTheDocument();

    rerender(<Markdown content={MERMAID_STREAMING} cacheKey="other-block" isStreaming />);
    cleanup();
    render(<Markdown content={MERMAID} cacheKey="reused-block" />);

    expect(await screen.findByTestId("mermaid-diagram")).toHaveTextContent("A-->B");
  });
});
