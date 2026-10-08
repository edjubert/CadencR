import { describe, expect, it } from "vitest";
import {
  browserPartitionForProfile,
  createBrowserProfile,
  isPersistentProfileId,
} from "./browser-profiles";

describe("browser profiles", () => {
  it("uses non-persist partitions for fresh ephemeral profiles", () => {
    const profile = createBrowserProfile("fresh");

    expect(profile.mode).toBe("fresh");
    expect(browserPartitionForProfile(profile)).not.toContain("persist:");
  });

  it("uses persist:browser partitions for persistent profiles", () => {
    const profile = createBrowserProfile("persistent", "dev-login");

    expect(profile.id).toBe("dev-login");
    expect(browserPartitionForProfile(profile)).toBe("persist:browser:dev-login");
  });

  it("keeps the normal profile on the established default partition", () => {
    expect(browserPartitionForProfile(createBrowserProfile("persistent", "default"))).toBe(
      "persist:browser:default",
    );
  });

  it("rejects unsafe persistent profile ids", () => {
    expect(isPersistentProfileId("dev-login_1")).toBe(true);
    expect(isPersistentProfileId("../secret")).toBe(false);
    expect(isPersistentProfileId("persist:bad")).toBe(false);
  });
});
