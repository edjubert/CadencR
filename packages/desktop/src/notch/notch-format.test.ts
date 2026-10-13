import { describe, expect, it } from "vitest";
import { formatAge, formatElapsed } from "./notch-format";

describe("formatElapsed", () => {
  it("formats minutes and hours", () => {
    expect(formatElapsed(7_000)).toBe("0:07");
    expect(formatElapsed(247_000)).toBe("4:07");
    expect(formatElapsed(3_765_000)).toBe("1:02:45");
    expect(formatElapsed(-5)).toBe("0:00");
  });
});

describe("formatAge", () => {
  it("compacts ages", () => {
    expect(formatAge(20_000)).toBe("now");
    expect(formatAge(4 * 60_000)).toBe("4m");
    expect(formatAge(2 * 3_600_000)).toBe("2h");
    expect(formatAge(3 * 86_400_000)).toBe("3d");
  });
});
