import { describe, expect, it, vi } from "vitest";
import { parseSettingsSearch, resolveSettingsTab } from "./settings-navigation";
import { NAV_GROUPS } from "./settings-nav-groups";

vi.mock("@/lib/marketplace-gate", () => ({ MARKETPLACE_ENABLED: true }));

describe("settings navigation", () => {
  it("defaults to General and preserves general section deep links", () => {
    expect(resolveSettingsTab(parseSettingsSearch({}))).toBe("general");
    const search = parseSettingsSearch({ section: "appearance" });
    expect(search.section).toBe("appearance");
    expect(resolveSettingsTab(search)).toBe("general");
  });

  it("supports Marketplace URL selection and legacy section links", () => {
    expect(resolveSettingsTab(parseSettingsSearch({ tab: "marketplace" }))).toBe("marketplace");
    expect(resolveSettingsTab(parseSettingsSearch({ section: "marketplace" }))).toBe("marketplace");
  });

  it("honors an explicit tab over a stale section", () => {
    expect(
      resolveSettingsTab(parseSettingsSearch({ tab: "general", section: "marketplace" })),
    ).toBe("general");
    expect(
      resolveSettingsTab(parseSettingsSearch({ tab: "marketplace", section: "appearance" })),
    ).toBe("marketplace");
  });

  it("validates unknown URL input without rejecting the page", () => {
    expect(parseSettingsSearch({ tab: "missing", section: 42 })).toEqual({
      tab: undefined,
      section: undefined,
    });
    expect(
      resolveSettingsTab(parseSettingsSearch({ tab: "missing", section: "marketplace" })),
    ).toBe("marketplace");
  });

  it("does not offer Marketplace as a general scrolling section", () => {
    const sections = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.id));
    expect(sections).not.toContain("marketplace");
    expect(sections).toContain("appearance");
    expect(sections).toContain("providers");
  });
});
