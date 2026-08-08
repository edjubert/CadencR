import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./useNeovimEngine", () => ({
  useNeovimEngine: vi.fn(() => ({
    status: "ready",
    errorMessage: null,
    feed: vi.fn(),
    applicationCursor: () => false,
  })),
}));

const connectMock = vi.fn();
vi.mock("./useNeovimWebSocket", () => ({
  useNeovimWebSocket: vi.fn(() => ({
    connect: connectMock,
    write: vi.fn(),
    resize: vi.fn(),
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
});

describe("NeovimPane error state", () => {
  it("shows the engine error message instead of a silent blank pane", async () => {
    const { useNeovimEngine } = await import("./useNeovimEngine");
    vi.mocked(useNeovimEngine).mockReturnValueOnce({
      status: "error",
      errorMessage: "WebGPU is unavailable",
      feed: vi.fn(),
      applicationCursor: () => false,
    });
    render(<NeovimPane featureId={1} />);
    expect(screen.getByText(/WebGPU is unavailable/)).toBeInTheDocument();
  });
});
