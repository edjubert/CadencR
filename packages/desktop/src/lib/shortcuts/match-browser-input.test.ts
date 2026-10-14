import { describe, expect, it } from "vitest";

import { matchesBrowserShortcutInput } from "./match-browser-input";

describe("matchesBrowserShortcutInput", () => {
  it("matches letters by layout-aware key rather than physical code", () => {
    expect(
      matchesBrowserShortcutInput(
        { key: "f", code: "KeyG", meta: true },
        { keys: ["mod", "f"] },
        "mac",
      ),
    ).toBe(true);
  });

  it("honors overrides and alternate bindings without retaining Cmd+F", () => {
    const binding = { keys: ["mod", "k"], altKeys: ["ctrl", "shift", "f"] };
    expect(
      matchesBrowserShortcutInput({ key: "f", code: "KeyF", meta: true }, binding, "mac"),
    ).toBe(false);
    expect(
      matchesBrowserShortcutInput({ key: "k", code: "KeyK", meta: true }, binding, "mac"),
    ).toBe(true);
    expect(
      matchesBrowserShortcutInput(
        { key: "f", code: "KeyF", control: true, shift: true },
        binding,
        "mac",
      ),
    ).toBe(true);
  });

  it("supports control-mangled keys and treats an empty chord as disabled", () => {
    expect(
      matchesBrowserShortcutInput(
        { key: "\u0006", code: "KeyF", control: true },
        { keys: ["mod", "f"] },
        "linux",
      ),
    ).toBe(true);
    expect(
      matchesBrowserShortcutInput({ key: "f", code: "KeyF", control: true }, { keys: [] }, "linux"),
    ).toBe(false);
  });
});
