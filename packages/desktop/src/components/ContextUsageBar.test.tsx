import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@/test-utils";
import { ContextUsageBar } from "./ContextUsageBar";
import { useClaudeCodeOauthUsage } from "@/hooks/useClaudeCodeOauthUsage";
import type { ContextUsageState } from "@/types/agent";

vi.mock("@/hooks/useClaudeCodeOauthUsage", () => ({
  useClaudeCodeOauthUsage: vi.fn(() => ({
    status: "unavailable",
    snapshot: null,
    reason: "not authenticated via claude login",
    fetchedAt: null,
    isRefreshing: false,
    refresh: vi.fn(),
  })),
}));

function makeUsage(
  overrides: Partial<ContextUsageState> & { usageRatio?: number } = {},
): ContextUsageState {
  const ratio = overrides.usageRatio;
  const { usageRatio: _ignored, ...rest } = overrides;
  const base: ContextUsageState = {
    inputTokens: 10000,
    outputTokens: 0,
    contextWindow: 200000,
    wasCompacted: false,
    costUsd: null,
    ...rest,
  };
  if (ratio != null && base.contextWindow && base.contextWindow > 0) {
    // Adjust tokens so `usageRatio(base)` equals the requested ratio.
    const target = Math.round(ratio * base.contextWindow);
    base.inputTokens = target;
    base.outputTokens = 0;
  }
  return base;
}

describe("ContextUsageBar", () => {
  it("renders nothing when usage is null", () => {
    const { container } = render(<ContextUsageBar usage={null} isStreaming={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when usage is undefined", () => {
    const { container } = render(<ContextUsageBar usage={undefined} isStreaming={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("displays usage as percentage", () => {
    render(<ContextUsageBar usage={makeUsage({ usageRatio: 0.05 })} isStreaming={false} />);
    expect(screen.getByText("5%")).toBeInTheDocument();
  });

  it("displays high usage as percentage", () => {
    render(<ContextUsageBar usage={makeUsage({ usageRatio: 0.75 })} isStreaming={false} />);
    expect(screen.getByText("75%")).toBeInTheDocument();
  });

  it("renders low usage (green)", () => {
    const { container } = render(
      <ContextUsageBar usage={makeUsage({ usageRatio: 0.3 })} isStreaming={false} />,
    );
    expect(container.querySelector(".h-full.rounded-full")?.className).toContain(
      "bg-[var(--acc-green)]",
    );
  });

  it("renders medium usage (yellow)", () => {
    const { container } = render(
      <ContextUsageBar usage={makeUsage({ usageRatio: 0.6 })} isStreaming={false} />,
    );
    expect(container.querySelector(".h-full.rounded-full")?.className).toContain(
      "bg-[var(--acc-yellow)]",
    );
  });

  it("renders high usage (orange)", () => {
    const { container } = render(
      <ContextUsageBar usage={makeUsage({ usageRatio: 0.85 })} isStreaming={false} />,
    );
    expect(container.querySelector(".h-full.rounded-full")?.className).toContain(
      "bg-[var(--acc-orange)]",
    );
  });

  it("renders critical usage (red)", () => {
    const { container } = render(
      <ContextUsageBar usage={makeUsage({ usageRatio: 0.95 })} isStreaming={false} />,
    );
    expect(container.querySelector(".h-full.rounded-full")?.className).toContain(
      "bg-[var(--acc-red)]",
    );
  });

  it("renders usage-glow style when active", () => {
    const { container } = render(
      <ContextUsageBar usage={makeUsage({ usageRatio: 0.6 })} isStreaming />,
    );

    expect(container.querySelector(".context-usage-glow")).toBeInTheDocument();
    expect(container.querySelector('[data-context-usage-style="glow"]')).toBeInTheDocument();
  });

  it("does not animate usage-glow when inactive", () => {
    const { container } = render(
      <ContextUsageBar usage={makeUsage({ usageRatio: 0.6 })} isStreaming={false} />,
    );

    expect(container.querySelector(".context-usage-glow")).not.toBeInTheDocument();
  });

  it("renders 0% with no fill when tokens are 0 but contextWindow is known", () => {
    const { container } = render(
      <ContextUsageBar
        usage={makeUsage({
          inputTokens: 0,
          outputTokens: 0,
          contextWindow: 1_000_000,
        })}
        isStreaming={false}
      />,
    );
    const bar = container.querySelector<HTMLDivElement>(".h-full.rounded-full");
    expect(bar).not.toBeNull();
    expect(bar!.style.width).toBe("0%");
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("renders nothing when contextWindow is unknown (null)", () => {
    const { container } = render(
      <ContextUsageBar
        usage={{
          inputTokens: 0,
          outputTokens: 0,
          contextWindow: null,
          wasCompacted: false,
          costUsd: null,
        }}
        isStreaming={false}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when contextWindow is 0", () => {
    const { container } = render(
      <ContextUsageBar
        usage={makeUsage({ inputTokens: 0, outputTokens: 0, contextWindow: 0 })}
        isStreaming={false}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows token detail popover on hover", async () => {
    const user = userEvent.setup();
    render(
      <ContextUsageBar
        usage={makeUsage({ inputTokens: 40000, outputTokens: 5230, contextWindow: 200000 })}
        isStreaming={false}
      />,
    );

    expect(screen.queryByText("45,230 / 200,000")).not.toBeInTheDocument();

    await user.hover(screen.getByRole("button", { name: /context usage 23%/i }));

    expect(await screen.findByText("Context")).toBeInTheDocument();
    expect(screen.getByText("45,230 / 200,000")).toBeInTheDocument();
    expect(screen.queryByText("Input")).not.toBeInTheDocument();
    expect(screen.queryByText("Output")).not.toBeInTheDocument();
    expect(screen.getAllByText("23%")).toHaveLength(1);
  });

  it("hides the popover again on unhover", async () => {
    const user = userEvent.setup();
    render(<ContextUsageBar usage={makeUsage({ usageRatio: 0.3 })} isStreaming={false} />);

    const trigger = screen.getByRole("button", { name: /context usage 30%/i });
    await user.hover(trigger);
    expect(await screen.findByText("Context")).toBeInTheDocument();

    await user.unhover(trigger);
    await waitFor(() => {
      expect(screen.queryByText("Context")).not.toBeInTheDocument();
    });
  });

  it("shows the compacted note only when wasCompacted is true", async () => {
    const user = userEvent.setup();
    render(
      <ContextUsageBar
        usage={makeUsage({ usageRatio: 0.3, wasCompacted: true })}
        isStreaming={false}
      />,
    );

    await user.hover(screen.getByRole("button", { name: /context usage 30%/i }));

    expect(await screen.findByText("Context compacted")).toBeInTheDocument();
  });

  it("omits the compacted note when wasCompacted is false", async () => {
    const user = userEvent.setup();
    render(<ContextUsageBar usage={makeUsage({ usageRatio: 0.3 })} isStreaming={false} />);

    await user.hover(screen.getByRole("button", { name: /context usage 30%/i }));

    expect(await screen.findByText("Context")).toBeInTheDocument();
    expect(screen.queryByText("Context compacted")).not.toBeInTheDocument();
  });

  it("shows session cost when costUsd is present", async () => {
    const user = userEvent.setup();
    render(
      <ContextUsageBar
        usage={makeUsage({ usageRatio: 0.3, costUsd: 0.0421 })}
        isStreaming={false}
      />,
    );

    await user.hover(screen.getByRole("button", { name: /context usage 30%/i }));

    expect(await screen.findByText("Session cost")).toBeInTheDocument();
    expect(screen.getByText("$0.04")).toBeInTheDocument();
  });

  it("omits session cost when costUsd is null", async () => {
    const user = userEvent.setup();
    render(<ContextUsageBar usage={makeUsage({ usageRatio: 0.3 })} isStreaming={false} />);

    await user.hover(screen.getByRole("button", { name: /context usage 30%/i }));

    expect(await screen.findByText("Context")).toBeInTheDocument();
    expect(screen.queryByText("Session cost")).not.toBeInTheDocument();
  });

  it("keeps keyboard hints outside the usage trigger", () => {
    render(<ContextUsageBar usage={makeUsage({ usageRatio: 0.3 })} isStreaming={false} />);

    const trigger = screen.getByRole("button", { name: /context usage 30%/i });
    expect(trigger).not.toHaveTextContent("send");
    expect(screen.getByText("send")).toBeInTheDocument();
  });

  it("shows quota bars when available", async () => {
    vi.mocked(useClaudeCodeOauthUsage).mockReturnValue({
      status: "available",
      snapshot: {
        five_hour: { utilization: 0.42 },
        seven_day: { utilization: 0.1 },
        seven_day_sonnet: { utilization: 0.05 },
        seven_day_opus: { utilization: 0 },
      },
      reason: null,
      fetchedAt: Math.floor(Date.now() / 1000) - 5,
      isRefreshing: false,
      refresh: vi.fn(),
    });
    const user = userEvent.setup();
    render(<ContextUsageBar usage={makeUsage({ usageRatio: 0.3 })} isStreaming={false} />);
    await user.hover(screen.getByRole("button", { name: /context usage 30%/i }));
    expect(await screen.findByText("42%")).toBeInTheDocument();
    expect(screen.getByText(/fetched 5s ago/i)).toBeInTheDocument();
  });

  it("hides the quota section when unavailable for a non-OAuth profile", async () => {
    vi.mocked(useClaudeCodeOauthUsage).mockReturnValue({
      status: "unavailable",
      snapshot: null,
      reason: "not authenticated via claude login",
      fetchedAt: null,
      isRefreshing: false,
      refresh: vi.fn(),
    });
    const user = userEvent.setup();
    render(<ContextUsageBar usage={makeUsage({ usageRatio: 0.3 })} isStreaming={false} />);
    await user.hover(screen.getByRole("button", { name: /context usage 30%/i }));
    expect(await screen.findByText("Context")).toBeInTheDocument();
    expect(screen.queryByText("Account quota")).not.toBeInTheDocument();
  });

  it("shows a visible message when the quota fetch actually failed", async () => {
    vi.mocked(useClaudeCodeOauthUsage).mockReturnValue({
      status: "unavailable",
      snapshot: null,
      reason: "unexpected status 500",
      fetchedAt: null,
      isRefreshing: false,
      refresh: vi.fn(),
    });
    const user = userEvent.setup();
    render(<ContextUsageBar usage={makeUsage({ usageRatio: 0.3 })} isStreaming={false} />);
    await user.hover(screen.getByRole("button", { name: /context usage 30%/i }));
    expect(await screen.findByText(/quota unavailable right now/i)).toBeInTheDocument();
  });

  it("disables the refresh button while a refresh is in flight, and clicking it is a no-op", async () => {
    const refresh = vi.fn();
    vi.mocked(useClaudeCodeOauthUsage).mockReturnValue({
      status: "available",
      snapshot: {
        five_hour: { utilization: 0.42 },
        seven_day: { utilization: 0.1 },
        seven_day_sonnet: { utilization: 0.05 },
        seven_day_opus: { utilization: 0 },
      },
      reason: null,
      fetchedAt: Math.floor(Date.now() / 1000),
      isRefreshing: true,
      refresh,
    });
    const user = userEvent.setup();
    render(<ContextUsageBar usage={makeUsage({ usageRatio: 0.3 })} isStreaming={false} />);
    await user.hover(screen.getByRole("button", { name: /context usage 30%/i }));
    const button = await screen.findByRole("button", { name: /refresh quota/i });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("clicking refresh calls refresh() when not already in flight", async () => {
    const refresh = vi.fn();
    vi.mocked(useClaudeCodeOauthUsage).mockReturnValue({
      status: "available",
      snapshot: {
        five_hour: { utilization: 0.42 },
        seven_day: { utilization: 0.1 },
        seven_day_sonnet: { utilization: 0.05 },
        seven_day_opus: { utilization: 0 },
      },
      reason: null,
      fetchedAt: Math.floor(Date.now() / 1000),
      isRefreshing: false,
      refresh,
    });
    const user = userEvent.setup();
    render(<ContextUsageBar usage={makeUsage({ usageRatio: 0.3 })} isStreaming={false} />);
    await user.hover(screen.getByRole("button", { name: /context usage 30%/i }));
    const button = await screen.findByRole("button", { name: /refresh quota/i });
    await user.click(button);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
