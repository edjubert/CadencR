import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@/test-utils";
import {
  LargeCodeBlock,
  LARGE_CODE_CHARACTER_THRESHOLD,
  LARGE_CODE_LINE_THRESHOLD,
  isLargeCodeBlock,
} from "./LargeCodeBlock";

vi.mock("react-virtuoso", async () => {
  const React = await import("react");
  interface MockProps {
    data?: unknown[];
    totalCount?: number;
    context?: unknown;
    itemContent: (index: number, data: unknown, context: unknown) => React.ReactNode;
    fixedItemHeight?: number;
    increaseViewportBy?: number;
    initialItemCount?: number;
    [key: string]: unknown;
  }
  function VirtuosoMock({
    data,
    totalCount,
    context,
    itemContent,
    fixedItemHeight: _fixedItemHeight,
    increaseViewportBy: _increaseViewportBy,
    initialItemCount: _initialItemCount,
    ...props
  }: MockProps): React.ReactElement {
    const [start, setStart] = React.useState(0);
    const itemCount = data?.length ?? totalCount ?? 0;
    const onScroll = (event: React.UIEvent<HTMLDivElement>): void => {
      setStart(Math.min(Math.floor(event.currentTarget.scrollTop / 20), itemCount - 1));
    };
    return React.createElement(
      "div",
      { ...props, onScroll },
      Array.from({ length: Math.min(12, itemCount - start) }, (_, offset) =>
        React.createElement(
          React.Fragment,
          { key: start + offset },
          itemContent(start + offset, data?.[start + offset], context),
        ),
      ),
    );
  }
  return {
    Virtuoso: VirtuosoMock,
  };
});

describe("large code fences", () => {
  it("switches at the line and character thresholds", () => {
    expect(
      isLargeCodeBlock(Array.from({ length: LARGE_CODE_LINE_THRESHOLD - 1 }, () => "x").join("\n")),
    ).toBe(false);
    expect(
      isLargeCodeBlock(Array.from({ length: LARGE_CODE_LINE_THRESHOLD }, () => "x").join("\n")),
    ).toBe(true);
    expect(isLargeCodeBlock("x".repeat(LARGE_CODE_CHARACTER_THRESHOLD - 1))).toBe(false);
    expect(isLargeCodeBlock("x".repeat(LARGE_CODE_CHARACTER_THRESHOLD))).toBe(true);
  });

  it("bounds rendered rows while copying the complete source", async () => {
    const code = Array.from({ length: 3_000 }, (_, index) => `line ${index}`).join("\n");
    const { user, container } = render(
      <LargeCodeBlock language="typescript" code={code} showTerminalButton={false} />,
    );
    const writeText = vi.spyOn(navigator.clipboard, "writeText");

    expect(container.querySelectorAll("[data-large-code-line]")).toHaveLength(12);
    expect(screen.getByRole("region", { name: "typescript code, 3000 lines" })).toHaveAttribute(
      "tabindex",
      "0",
    );
    await user.click(screen.getByRole("button", { name: /copy/i }));
    expect(writeText).toHaveBeenCalledWith(code);
  });

  it("bounds an extremely long visible line without changing copy content", async () => {
    const code = "a".repeat(1_000_000);
    const { user } = render(
      <LargeCodeBlock language="text" code={code} showTerminalButton={false} />,
    );
    const writeText = vi.spyOn(navigator.clipboard, "writeText");

    expect(screen.getByText(/998000 more characters/).textContent?.length).toBeLessThan(2_100);
    await user.click(screen.getByRole("button", { name: /copy/i }));
    expect(writeText).toHaveBeenCalledWith(code);
  });

  it("keeps the virtualized viewer mounted as streamed content grows", () => {
    const initial = Array.from({ length: 500 }, (_, index) => `line ${index}`).join("\n");
    const { container, rerender } = render(
      <LargeCodeBlock language="text" code={initial} isStreaming showTerminalButton={false} />,
    );
    const viewer = container.querySelector('[role="region"]');

    rerender(
      <LargeCodeBlock
        language="text"
        code={`${initial}\nnext`}
        isStreaming
        showTerminalButton={false}
      />,
    );
    expect(container.querySelector('[role="region"]')).toBe(viewer);
    expect(container.querySelectorAll("[data-large-code-line]")).toHaveLength(12);
    const updated = screen.getByRole("region", { name: "text code, 501 lines" });
    fireEvent.scroll(updated, { target: { scrollTop: 10_000 } });
    expect(container.querySelector('[data-large-code-line="501"]')).toHaveTextContent("next");
  });

  it("reveals a later bounded window when the focused viewer scrolls", () => {
    const code = Array.from({ length: 500 }, (_, index) => `line ${index}`).join("\n");
    const { container } = render(
      <LargeCodeBlock language="text" code={code} showTerminalButton={false} />,
    );
    const viewer = screen.getByRole("region");

    fireEvent.scroll(viewer, { target: { scrollTop: 2_000 } });
    expect(container.querySelector('[data-large-code-line="101"]')).toHaveTextContent("line 100");
    expect(container.querySelectorAll("[data-large-code-line]")).toHaveLength(12);
  });
});
