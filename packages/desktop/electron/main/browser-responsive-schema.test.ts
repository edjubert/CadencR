import { describe, expect, it } from "vitest";

import {
  DEFAULT_BROWSER_RESPONSIVE_STATE,
  toBrowserResponsiveRequest,
} from "../../src/shared/browser-responsive";
import { parseBrowserResponsiveRequest } from "./browser-responsive-schema";

describe("parseBrowserResponsiveRequest", () => {
  it("accepts an extracted renderer request and rejects leaked native status", () => {
    const state = { ...DEFAULT_BROWSER_RESPONSIVE_STATE, enabled: true };
    const request = toBrowserResponsiveRequest(state);

    expect(parseBrowserResponsiveRequest(request)).toEqual(request);
    expect(() => parseBrowserResponsiveRequest(state)).toThrow();
  });

  it("rejects oversized surfaces even when each dimension is independently bounded", () => {
    expect(() =>
      parseBrowserResponsiveRequest({
        ...toBrowserResponsiveRequest(DEFAULT_BROWSER_RESPONSIVE_STATE),
        width: 2_560,
        height: 2_560,
      }),
    ).toThrow("Responsive viewport area");
  });
});
