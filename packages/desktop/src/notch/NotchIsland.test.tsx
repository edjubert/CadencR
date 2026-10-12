import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NotchAgent, NotchBridge, NotchPrefs } from "@/shared/notch";
import { NotchIsland } from "./NotchIsland";

function agent(featureId: number, status: NotchAgent["status"]): NotchAgent {
  return {
    featureId,
    projectId: 1,
    title: `Agent ${featureId}`,
    projectName: "cadencr",
    status,
    pendingKind: status === "question" ? "permission" : null,
    providerLabel: null,
    providerIconSrc: null,
    providerIconMono: false,
    turnStartedAtMs: null,
    lastActivityAtMs: null,
    lastAction: null,
    preview: null,
    unread: false,
  };
}

function installBridge(prefs: NotchPrefs): void {
  const off = () => () => {};
  const bridge: NotchBridge = {
    ready: () =>
      Promise.resolve({
        geometry: {
          notchWidth: 200,
          notchHeight: 32,
          hardware: true,
          windowWidth: 720,
          windowHeight: 620,
        },
        snapshot: { agents: [agent(1, "question"), agent(2, "running")] },
        prefs,
      }),
    setHotRect: vi.fn(() => Promise.resolve()),
    openFeature: vi.fn(() => Promise.resolve()),
    dismiss: vi.fn(() => Promise.resolve()),
    onSnapshot: off,
    onNotification: off,
    onHover: off,
    onGeometry: off,
    onPrefs: off,
  };
  window.cadencrNotch = bridge;
}

async function renderCompactLayer(prefs: NotchPrefs): Promise<HTMLElement> {
  installBridge(prefs);
  const { container } = render(<NotchIsland />);
  await waitFor(() =>
    expect(container.querySelector('.island[data-mode="compact"]')).not.toBeNull(),
  );
  const layer = container.querySelector<HTMLElement>('.layer[data-active="true"]');
  if (!layer) throw new Error("No active layer");
  return layer;
}

describe("NotchIsland compact ears", () => {
  afterEach(() => {
    delete window.cadencrNotch;
  });

  it("shows the plain logo and still status dots with Always animate off", async () => {
    const layer = await renderCompactLayer({ alwaysOn: true, alwaysAnimate: false });

    expect(layer.querySelector(".orb")?.getAttribute("data-state")).toBe("logo");
    expect(layer.querySelector(".compact-dots")?.getAttribute("data-still")).toBe("true");
    expect(
      [...layer.querySelectorAll(".compact-dot")].map((dot) => dot.getAttribute("data-status")),
    ).toEqual(["question", "running"]);
  });

  it("shows the aggregate status orb with Always animate on", async () => {
    const layer = await renderCompactLayer({ alwaysOn: true, alwaysAnimate: true });

    expect(layer.querySelector(".orb")?.getAttribute("data-state")).toBe("question");
    expect(layer.querySelector(".compact-dots")?.getAttribute("data-still")).toBe("false");
  });
});
