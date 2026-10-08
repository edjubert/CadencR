import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_BROWSER_RESPONSIVE_STATE } from "../../src/shared/browser-responsive";
import {
  clearResponsiveOverrides,
  responsiveDeviceMetricsParams,
} from "./browser-responsive-emulation";

describe("responsiveDeviceMetricsParams", () => {
  it("keeps mobile CSS metrics independent from page zoom", () => {
    expect(
      responsiveDeviceMetricsParams(
        { ...DEFAULT_BROWSER_RESPONSIVE_STATE, enabled: true },
        494 / 844,
        1.2,
      ),
    ).toEqual({
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      mobile: true,
      scale: 494 / 844,
      screenWidth: 390,
      screenHeight: 844,
      positionX: 0,
      positionY: 0,
    });
  });

  it("rounds desktop device metrics up while compensating page zoom", () => {
    expect(
      responsiveDeviceMetricsParams(
        {
          ...DEFAULT_BROWSER_RESPONSIVE_STATE,
          enabled: true,
          preset: "custom",
          width: 412,
          height: 915,
          deviceScaleFactor: 2,
          mobile: false,
        },
        494 / 915,
        1.2,
      ),
    ).toEqual({
      width: 495,
      height: 1_098,
      deviceScaleFactor: 2 / 1.2,
      mobile: false,
      scale: 494 / 915 / 1.2,
      screenWidth: 412,
      screenHeight: 915,
      positionX: 0,
      positionY: 0,
    });
  });
});

describe("clearResponsiveOverrides", () => {
  it("attempts metrics, touch, mouse-event and media cleanup after an early failure", async () => {
    const sendCommand = vi
      .fn()
      .mockRejectedValueOnce(new Error("touch cleanup failed"))
      .mockResolvedValue(undefined);
    const debug = Object.assign(new EventEmitter(), {
      isAttached: () => true,
      attach: vi.fn(),
      sendCommand,
    });
    const webContents = { debugger: debug } as unknown as Electron.WebContents;

    await expect(clearResponsiveOverrides(webContents)).resolves.toBeInstanceOf(AggregateError);

    expect(sendCommand.mock.calls).toEqual([
      ["Emulation.clearDeviceMetricsOverride", {}],
      ["Emulation.setTouchEmulationEnabled", { enabled: false }],
      ["Emulation.setEmitTouchEventsForMouse", { enabled: false, configuration: "desktop" }],
      ["Emulation.setEmulatedMedia", { media: "", features: [] }],
    ]);
  });
});
