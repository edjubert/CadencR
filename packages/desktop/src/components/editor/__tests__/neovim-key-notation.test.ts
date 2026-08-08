import { describe, expect, it } from "vitest";
import { toNeovimKeyNotation } from "../neovim-key-notation";

function makeKeyboardEvent(init: Partial<KeyboardEventInit> & { key: string }): KeyboardEvent {
  return new KeyboardEvent("keydown", init);
}

describe("toNeovimKeyNotation", () => {
  it("passes plain printable characters through unchanged", () => {
    expect(toNeovimKeyNotation(makeKeyboardEvent({ key: "j" }))).toBe("j");
    expect(toNeovimKeyNotation(makeKeyboardEvent({ key: "d" }))).toBe("d");
  });

  it("translates Escape to <Esc>", () => {
    expect(toNeovimKeyNotation(makeKeyboardEvent({ key: "Escape" }))).toBe("<Esc>");
  });

  it("translates Enter to <CR>", () => {
    expect(toNeovimKeyNotation(makeKeyboardEvent({ key: "Enter" }))).toBe("<CR>");
  });

  it("translates arrow keys", () => {
    expect(toNeovimKeyNotation(makeKeyboardEvent({ key: "ArrowLeft" }))).toBe("<Left>");
    expect(toNeovimKeyNotation(makeKeyboardEvent({ key: "ArrowDown" }))).toBe("<Down>");
    expect(toNeovimKeyNotation(makeKeyboardEvent({ key: "ArrowUp" }))).toBe("<Up>");
    expect(toNeovimKeyNotation(makeKeyboardEvent({ key: "ArrowRight" }))).toBe("<Right>");
  });

  it("translates Ctrl+letter combinations", () => {
    expect(toNeovimKeyNotation(makeKeyboardEvent({ key: "w", ctrlKey: true }))).toBe("<C-w>");
  });

  it("translates Tab and Backspace", () => {
    expect(toNeovimKeyNotation(makeKeyboardEvent({ key: "Tab" }))).toBe("<Tab>");
    expect(toNeovimKeyNotation(makeKeyboardEvent({ key: "Backspace" }))).toBe("<BS>");
  });
});
