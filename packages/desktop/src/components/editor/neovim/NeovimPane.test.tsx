import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const encodePointerMock = vi.fn<(...args: unknown[]) => Uint8Array | undefined>(() => undefined);
vi.mock("./useNeovimEngine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./useNeovimEngine")>()),
  useNeovimEngine: vi.fn(() => ({
    status: "ready",
    errorMessage: null,
    feed: vi.fn(),
    applicationCursor: () => false,
    currentGrid: () => ({ columns: 80, lines: 24 }),
    encodePointer: encodePointerMock,
  })),
}));

const connectMock = vi.fn();
const resizeMock = vi.fn();
const writeMock = vi.fn();
vi.mock("./useNeovimWebSocket", () => ({
  useNeovimWebSocket: vi.fn(() => ({
    connect: connectMock,
    write: writeMock,
    resize: resizeMock,
    detach: vi.fn(),
    isConnected: true,
  })),
}));

vi.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({
    theme: {
      xterm: {
        background: "#000",
        foreground: "#fff",
        cursor: "#fff",
        cursorAccent: "#000",
        selectionBackground: "#333",
        selectionForeground: "#fff",
        selectionInactiveBackground: "#222",
        black: "#000",
        red: "#f00",
        green: "#0f0",
        yellow: "#ff0",
        blue: "#00f",
        magenta: "#f0f",
        cyan: "#0ff",
        white: "#fff",
        brightBlack: "#555",
        brightRed: "#f55",
        brightGreen: "#5f5",
        brightYellow: "#ff5",
        brightBlue: "#55f",
        brightMagenta: "#f5f",
        brightCyan: "#5ff",
        brightWhite: "#fff",
      },
    },
  }),
}));

const { default: NeovimPane } = await import("./NeovimPane");

describe("NeovimPane", () => {
  it("connects to the feature's neovim session on mount", () => {
    render(<NeovimPane featureId={1} />);
    expect(connectMock).toHaveBeenCalled();
  });

  it("renders a focusable surface once ready", () => {
    render(<NeovimPane featureId={1} />);
    expect(screen.getByRole("application")).toBeInTheDocument();
  });

  // Regression: the engine's own resize fires while the socket is still
  // connecting, so it gets dropped and Neovim keeps drawing for the PTY's
  // 120x40 spawn size against a differently sized grid — garbled output.
  it("re-sends the measured grid once the socket is connected", () => {
    resizeMock.mockClear();
    render(<NeovimPane featureId={1} />);
    expect(resizeMock).toHaveBeenCalledWith(80, 24);
  });

  it("forwards an encoded click to the pty", () => {
    writeMock.mockClear();
    encodePointerMock.mockReturnValueOnce(new Uint8Array([27, 91, 77]));
    render(<NeovimPane featureId={1} />);
    fireEvent.mouseDown(screen.getByRole("application"), { button: 0 });
    expect(writeMock).toHaveBeenCalledWith(new Uint8Array([27, 91, 77]));
  });

  it("leaves the event alone when Neovim asked for no mouse reporting", () => {
    writeMock.mockClear();
    encodePointerMock.mockReturnValueOnce(undefined);
    render(<NeovimPane featureId={1} />);
    fireEvent.mouseDown(screen.getByRole("application"), { button: 0 });
    expect(writeMock).not.toHaveBeenCalled();
  });
});

describe("NeovimPane error state", () => {
  it("shows the engine error message instead of a silent blank pane", async () => {
    const { useNeovimEngine } = await import("./useNeovimEngine");
    vi.mocked(useNeovimEngine).mockReturnValueOnce({
      status: "error",
      errorMessage: "WebGPU is unavailable",
      feed: vi.fn(),
      applicationCursor: () => false,
      currentGrid: () => ({ columns: 80, lines: 24 }),
      encodePointer: encodePointerMock,
    });
    render(<NeovimPane featureId={1} />);
    expect(screen.getByText(/WebGPU is unavailable/)).toBeInTheDocument();
  });
});
