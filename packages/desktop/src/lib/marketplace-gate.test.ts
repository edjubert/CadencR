import { describe, expect, it } from "vitest";
import { MARKETPLACE_ENABLED, marketplaceBuildEnabled } from "./marketplace-gate";

describe("unreleased marketplace build gate", () => {
  it("is disabled by default", () => {
    expect(MARKETPLACE_ENABLED).toBe(false);
  });
  it.each([undefined, "", "false", "1", true])("rejects non-explicit opt-in %s", (value) => {
    expect(marketplaceBuildEnabled(true, value)).toBe(false);
  });
  it("allows explicit development/QA builds only", () => {
    expect(marketplaceBuildEnabled(true, "true")).toBe(true);
    expect(marketplaceBuildEnabled(false, "true")).toBe(false);
  });
});
