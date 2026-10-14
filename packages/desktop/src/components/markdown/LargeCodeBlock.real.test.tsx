import { describe, expect, it, vi } from "vitest";
import { render } from "@/test-utils";
import { LargeCodeBlock } from "./LargeCodeBlock";

// The shared test setup mocks Virtuoso by rendering every item. This smoke test
// deliberately uses the real library to guard the bounded initial-paint path.
vi.unmock("react-virtuoso");

describe("LargeCodeBlock with real Virtuoso", () => {
  it("paints a nonempty bounded initial window before layout measurement", () => {
    const code = Array.from({ length: 3_000 }, (_, index) => `line ${index}`).join("\n");
    const { container } = render(
      <LargeCodeBlock language="text" code={code} showTerminalButton={false} />,
    );
    const rows = container.querySelectorAll("[data-large-code-line]");

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(30);
    expect(rows[0]).toHaveTextContent("line 0");
  });
});
