import { describe, expect, it, vi } from "vitest";

import type { BrowserTabMetadata } from "@/lib/desktop-bridge";
import { fireEvent, render, screen } from "@/test-utils";
import { BrowserTabOverflow } from "./BrowserTabOverflow";

function tab(id: string, title: string): BrowserTabMetadata {
  return {
    id,
    title,
    url: `https://${id}.example/`,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    sessionProfileId: "default",
    isActive: id === "alpha",
    devToolsOpen: false,
    pinned: false,
    suspended: false,
    zoomPercent: 100,
    responsive: {
      enabled: false,
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

describe("BrowserTabOverflow", () => {
  it("notifies suppression when keyboard selection closes the searchable list", async () => {
    const onActivate = vi.fn();
    const onOpenChange = vi.fn();
    const { user } = render(
      <BrowserTabOverflow
        tabs={[tab("alpha", "Alpha"), tab("beta", "Beta")]}
        activeTabId="beta"
        busy={false}
        onActivate={onActivate}
        onClose={vi.fn()}
        onReopen={vi.fn()}
        onOpenChange={onOpenChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Search all 2 browser tabs" }));
    const search = await screen.findByRole("combobox", { name: "Search browser tabs" });
    fireEvent.change(search, { target: { value: "Alpha" } });
    fireEvent.keyDown(search, { key: "Enter" });

    expect(onActivate).toHaveBeenCalledWith("alpha");
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole("combobox", { name: "Search browser tabs" })).toBeNull();
  });

  it("shows each website favicon in the tab list", async () => {
    const alpha = {
      ...tab("alpha", "Alpha"),
      faviconUrl: "data:image/png;base64,iVBORw0KGgo=",
    };
    const { user } = render(
      <BrowserTabOverflow
        tabs={[alpha]}
        activeTabId="alpha"
        busy={false}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onReopen={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Search all 1 browser tabs" }));
    const option = await screen.findByRole("option", { name: /Alpha/ });
    expect(option.querySelector("img")).toHaveAttribute("src", alpha.faviconUrl);
  });
});
