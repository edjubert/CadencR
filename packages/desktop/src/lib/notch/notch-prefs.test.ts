import { describe, expect, it } from "vitest";
import { parseNotchPrefs } from "./notch-prefs";

describe("parseNotchPrefs", () => {
  it("defaults to always on with a still logo", () => {
    expect(parseNotchPrefs({ alwaysOn: undefined, alwaysAnimate: "" })).toEqual({
      alwaysOn: true,
      alwaysAnimate: false,
    });
  });

  it("honors explicit values", () => {
    expect(parseNotchPrefs({ alwaysOn: "false", alwaysAnimate: "true" })).toEqual({
      alwaysOn: false,
      alwaysAnimate: true,
    });
  });
});
