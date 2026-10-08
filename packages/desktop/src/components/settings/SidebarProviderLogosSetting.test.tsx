import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { render, screen, waitFor } from "@/test-utils";
import { server } from "@/test/msw-server";
import { SidebarPreferences } from "@/components/SidebarPreferences";
import { SidebarProviderBadge } from "@/components/SidebarProviderBadge";
import { SidebarStatusIndicator } from "@/components/SidebarStatusIndicator";
import { SidebarProviderLogosSetting } from "./SidebarProviderLogosSetting";

vi.mock("@/components/ShortcutTooltip", () => ({
  ShortcutTooltip: ({ children }: { children: unknown }) => children,
}));

function Fixture() {
  return (
    <>
      <SidebarProviderLogosSetting />
      <SidebarPreferences>
        <SidebarProviderBadge providerId="codex_cli" />
        <SidebarStatusIndicator
          featureId={1}
          liveStatus="agent"
          isActive={false}
          isUnread={false}
          onOpenConversation={vi.fn()}
        />
      </SidebarPreferences>
    </>
  );
}

const url = "*/api/workspace/settings/sidebar_provider_logos";

describe("sidebar provider preference", () => {
  it("waits for persistence, hides only branding, and reads the saved value on remount", async () => {
    let value = "true";
    let confirm: (() => void) | undefined;
    const confirmed = new Promise<void>((resolve) => {
      confirm = resolve;
    });
    server.use(
      http.get(url, () => HttpResponse.json({ value })),
      http.put(url, async () => {
        await confirmed;
        value = "false";
        return HttpResponse.json({ value });
      }),
    );
    const view = render(<Fixture />);
    const toggle = await screen.findByRole("switch");
    await waitFor(() => expect(toggle).toBeEnabled());
    await view.user.click(toggle);
    expect(screen.getByLabelText("Saving sidebar preference")).toBeInTheDocument();
    expect(toggle).toBeDisabled();
    expect(screen.getByRole("img", { name: /Codex/ })).toBeInTheDocument();
    confirm?.();
    await waitFor(() =>
      expect(screen.queryByRole("img", { name: /Codex/ })).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Agent working")).toBeInTheDocument();
    view.unmount();
    render(<Fixture />);
    await waitFor(() => expect(screen.getByRole("switch")).not.toBeChecked());
    expect(screen.queryByRole("img", { name: /Codex/ })).not.toBeInTheDocument();
  });

  it("keeps branding visible and re-enables the switch on a failed save", async () => {
    server.use(
      http.get(url, () => HttpResponse.json({ value: "true" })),
      http.put(url, () => HttpResponse.json({ error: "Save failed" }, { status: 500 })),
    );
    const { user } = render(<Fixture />);
    const toggle = await screen.findByRole("switch");
    await waitFor(() => expect(toggle).toBeEnabled());
    await user.click(toggle);
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).toBeChecked();
    expect(screen.getByRole("img", { name: /Codex/ })).toBeInTheDocument();
  });
});
