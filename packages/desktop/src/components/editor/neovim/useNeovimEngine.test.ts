import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/neovim/terminal-engine", () => {
  class FakeTerminal {
    columns = 80;
    screenLines = 24;
    applicationCursor = false;
    constructor(
      public initialColumns: number,
      public initialLines: number,
    ) {
      this.columns = initialColumns;
      this.screenLines = initialLines;
    }
    feed(_bytes: Uint8Array) {}
    resize(cols: number, lines: number) {
      this.columns = cols;
      this.screenLines = lines;
    }
    refreshSnapshot() {}
    snapshotPtr() {
      return 0;
    }
    snapshotLen() {
      return 0;
    }
  }
  return {
    loadTerminalEngine: vi.fn(async () => undefined),
    Terminal: FakeTerminal,
    encodeKey: vi.fn(() => new Uint8Array([0x61])),
    encodeMouse: vi.fn(() => undefined),
  };
});

const { computeGridResize } = await import("./useNeovimEngine");

describe("computeGridResize", () => {
  it("only reports a change when the cell count actually differs", () => {
    expect(computeGridResize({ columns: 80, lines: 24 }, { columns: 80, lines: 24 })).toBeNull();
    expect(computeGridResize({ columns: 80, lines: 24 }, { columns: 90, lines: 24 })).toEqual({
      columns: 90,
      lines: 24,
    });
  });
});
