import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@/test-utils";
import { SidebarShortcutBadge } from "@/components/SidebarShortcutBadge";
import { ShortcutHintsProvider, useNavShortcutHint } from "./useNavShortcutHints";

const platform = vi.hoisted(() => ({ isMac: true }));
vi.mock("@/lib/shortcuts/format", () => ({
  get PLATFORM_IS_MAC() {
    return platform.isMac;
  },
}));

function Row({ onClick }: { onClick: () => void }) {
  const { navRef, badgeRef } = useNavShortcutHint<HTMLButtonElement>();
  return (
    <button ref={navRef} onClick={onClick}>
      Conversation
      <SidebarShortcutBadge ref={badgeRef} inline />
    </button>
  );
}

async function setup(isMac: boolean, layoutKey = "1") {
  platform.isMac = isMac;
  Object.defineProperty(navigator, "keyboard", {
    configurable: true,
    value: { getLayoutMap: async () => new Map([["Digit1", layoutKey]]) },
  });
  const onClick = vi.fn();
  await act(async () => {
    render(
      <ShortcutHintsProvider enabled>
        <Row onClick={onClick} />
      </ShortcutHintsProvider>,
    );
  });
  const badge = document.querySelector("[data-nav-shortcut-badge]");
  return { onClick, badge };
}

describe("sidebar modifier hints", () => {
  beforeEach(() => {
    platform.isMac = true;
  });

  it.each([true, false])("shows platform-correct hints and navigates (mac=%s)", async (isMac) => {
    const { badge, onClick } = await setup(isMac);
    const modifier = isMac ? { metaKey: true } : { ctrlKey: true };
    const key = isMac ? "Meta" : "Control";
    fireEvent.keyDown(window, { key, ...modifier });
    expect(badge).toHaveAttribute("data-visible", "true");
    expect(badge).toHaveTextContent("1");
    fireEvent.keyDown(window, { key: "1", code: "Digit1", ...modifier });
    expect(onClick).toHaveBeenCalledOnce();
    fireEvent.keyUp(window, { key });
    expect(badge).toHaveAttribute("data-visible", "false");
  });

  it.each([true, false])(
    "uses the labelled AZERTY key rather than a QWERTY digit (mac=%s)",
    async (isMac) => {
      const { badge, onClick } = await setup(isMac, "&");
      const modifier = isMac ? { metaKey: true } : { ctrlKey: true };
      fireEvent.keyDown(window, { key: "&", code: "Digit1", ...modifier });
      expect(badge).toHaveTextContent("&");
      expect(onClick).toHaveBeenCalledOnce();
      fireEvent.blur(window);
      expect(badge).toHaveAttribute("data-visible", "false");
    },
  );

  it("does not intercept Control-number on macOS", async () => {
    const { badge, onClick } = await setup(true);
    fireEvent.keyDown(screen.getByRole("button"), { key: "1", ctrlKey: true });
    expect(badge).toHaveAttribute("data-visible", "false");
    expect(onClick).not.toHaveBeenCalled();
  });
});
