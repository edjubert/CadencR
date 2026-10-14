import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor } from "@/test-utils";
import type { BrowserResponsiveRequest, BrowserTabMetadata } from "@/lib/desktop-bridge";
import { BrowserResponsiveToolbar } from "./BrowserResponsiveToolbar";

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

function tab(): BrowserTabMetadata {
  return {
    id: "tab-1",
    title: "Example",
    url: "https://example.com/",
    loading: false,
    canGoBack: false,
    canGoForward: false,
    sessionProfileId: "default",
    isActive: true,
    devToolsOpen: false,
    pinned: false,
    suspended: false,
    zoomPercent: 100,
    responsive: {
      enabled: true,
      preset: "mobile",
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      mobile: true,
      touch: true,
      colorScheme: "system",
      status: "ready",
    },
    scopeId: 1,
  };
}

describe("BrowserResponsiveToolbar", () => {
  it("applies a rotated preset, touch and appearance as an exact request", async () => {
    const onApply = vi.fn(async (_request: BrowserResponsiveRequest) => undefined);
    const onOverlayOpenChange = vi.fn();
    const { user } = render(
      <BrowserResponsiveToolbar
        tab={tab()}
        pending={false}
        displayScale={0.56}
        onApply={onApply}
        onOverlayOpenChange={onOverlayOpenChange}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Responsive device preset" }));
    await waitFor(() => expect(onOverlayOpenChange).toHaveBeenLastCalledWith(true));
    await user.click(screen.getByRole("option", { name: "Tablet" }));
    await waitFor(() => expect(onOverlayOpenChange).toHaveBeenLastCalledWith(false));
    expect(screen.getByRole("spinbutton", { name: "Viewport width" })).toHaveValue(768);
    expect(screen.getByRole("spinbutton", { name: "Viewport height" })).toHaveValue(1_024);
    await user.click(screen.getByRole("button", { name: "Rotate responsive viewport" }));
    await user.click(screen.getByRole("button", { name: "Emulate touch input" }));
    await user.click(screen.getByRole("combobox", { name: "Emulated color scheme" }));
    await waitFor(() => expect(onOverlayOpenChange).toHaveBeenLastCalledWith(true));
    await user.click(screen.getByRole("option", { name: "Dark" }));
    await waitFor(() => expect(onOverlayOpenChange).toHaveBeenLastCalledWith(false));
    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(onApply).toHaveBeenCalledWith({
      enabled: true,
      preset: "tablet",
      width: 1_024,
      height: 768,
      deviceScaleFactor: 2,
      mobile: true,
      touch: false,
      colorScheme: "dark",
    });
  });

  it("blocks invalid custom dimensions but exits with confirmed settings", async () => {
    const onApply = vi.fn(async (_request: BrowserResponsiveRequest) => undefined);
    render(
      <BrowserResponsiveToolbar
        tab={tab()}
        pending={false}
        displayScale={0.56}
        onApply={onApply}
        onOverlayOpenChange={vi.fn()}
      />,
    );
    const width = screen.getByRole("spinbutton", { name: "Viewport width" });

    await userEvent.clear(width);
    await userEvent.type(width, "239");

    expect(screen.getByText(/240–2560 px/)).toBeInTheDocument();
    const apply = screen.getByRole("button", { name: "Apply" });
    const exit = screen.getByRole("button", { name: "Exit responsive mode" });
    expect(apply).toBeDisabled();
    expect(apply.parentElement).toBe(exit.parentElement);
    expect(apply.parentElement).toHaveClass("shrink-0");
    await userEvent.click(screen.getByRole("button", { name: "Exit responsive mode" }));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, width: 390 }));
    expect(onApply.mock.calls[0]?.[0]).not.toHaveProperty("status");
  });

  it("shows pending progress and a native cleanup recovery message", () => {
    const failed = tab();
    failed.responsive.status = "error";
    render(
      <BrowserResponsiveToolbar
        tab={failed}
        pending
        displayScale={0.56}
        onApply={vi.fn()}
        onOverlayOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByText(/could not be fully cleared/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Responsive device preset" })).toBeDisabled();
    expect(screen.getByRole("spinbutton", { name: "Viewport width" })).toBeDisabled();
    expect(screen.getByRole("spinbutton", { name: "Viewport height" })).toBeDisabled();
    expect(screen.getByText("Fit 56% · Chromium · mobile UA unchanged")).toHaveAttribute(
      "title",
      expect.stringMatching(/does not emulate Safari/),
    );
  });
});
