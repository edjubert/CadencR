import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Key/mouse encoding, scrollback and the draw loop now live inside `Terminal`
// (celeritty), tested at the package level — NeovimPane only owns the
// socket and the transport bridge, so that is all this file mocks.
interface CelerittyTerminalMockResult {
  terminal: undefined;
  status: "loading" | "ready" | "error";
  errorMessage: string | null;
}
const celerittyTerminalMock = vi.fn<() => CelerittyTerminalMockResult>(() => ({
  terminal: undefined,
  status: "ready",
  errorMessage: null,
}));

const RESOLVED_TERMINAL_OPTIONS = {
  font: { family: "'Iosevka Nerd Font', monospace", size: 15 },
  colors: { foreground: "#fff", background: "#000" },
  cursor: { style: "beam" as const, blink: true },
  scrollback: 5_000,
};
let terminalOptionsError: string | null = null;
const terminalOptionsMock = vi.fn(() => ({
  options: terminalOptionsError ? undefined : RESOLVED_TERMINAL_OPTIONS,
  isLoading: false,
  error: terminalOptionsError,
}));

vi.mock("@/components/terminal-core", () => ({
  useCelerittyTerminal: (...args: unknown[]) => celerittyTerminalMock(...(args as [])),
  useTerminalOptions: (...args: unknown[]) => terminalOptionsMock(...(args as [])),
}));

vi.mock("@/lib/fonts/mono-font-setting", () => ({
  useMonoFont: () => ({
    family: "JetBrainsMono Nerd Font",
    resolved: '"JetBrainsMono Nerd Font", monospace',
    setFamily: vi.fn(),
    isLoading: false,
  }),
}));

const connectMock = vi.fn();
const snapshotMock = vi.fn();
const transportCloseMock = vi.fn();
let socketError: string | null = null;
let socketOptions: { onAttached: (data: Uint8Array) => void; onError: (error: string) => void };

vi.mock("./useNeovimWebSocket", () => ({
  useNeovimWebSocket: vi.fn((options: typeof socketOptions) => {
    socketOptions = options;
    return {
      connect: connectMock,
      write: vi.fn(),
      resize: vi.fn(),
      detach: vi.fn(),
      isConnected: true,
      lastError: socketError,
    };
  }),
}));

vi.mock("./useNeovimTransport", () => ({
  useNeovimTransport: vi.fn(() => ({
    transport: { write: vi.fn(), resize: vi.fn(), onData: vi.fn(), onClose: vi.fn() },
    deliverData: vi.fn(),
    deliverClose: transportCloseMock,
    deliverSnapshot: snapshotMock,
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
  afterEach(() => {
    socketError = null;
    celerittyTerminalMock.mockReturnValue({
      terminal: undefined,
      status: "ready",
      errorMessage: null,
    });
  });

  it("shows the terminal's error message instead of a silent blank pane", () => {
    // `mockReturnValue`, not `...Once`: mounting sets `connected`, which
    // re-renders, so the hook is called twice and a one-shot mock would be
    // consumed by the first pass and report "ready" on the second.
    celerittyTerminalMock.mockReturnValue({
      terminal: undefined,
      status: "error",
      errorMessage: "WebGPU is unavailable",
    });
    render(<NeovimPane featureId={1} />);
    expect(screen.getByText(/WebGPU is unavailable/)).toBeInTheDocument();
  });
});

describe("Neovim attachment replay", () => {
  it("replaces the display from attachment snapshots rather than appending duplicated output", () => {
    render(<NeovimPane featureId={1} />);
    const bytes = new TextEncoder().encode("screen");
    act(() => socketOptions.onAttached(bytes));
    expect(snapshotMock).toHaveBeenCalledWith(bytes);
  });

  it("keeps the host mounted and shows socket errors even after the renderer is ready", () => {
    socketError = "failed to start neovim";
    render(<NeovimPane featureId={1} />);
    expect(screen.getByRole("application")).toBeInTheDocument();
    expect(screen.getByText(/failed to start neovim/)).toBeInTheDocument();
    socketError = null;
  });
});

describe("NeovimPane appearance", () => {
  afterEach(() => {
    terminalOptionsError = null;
  });

  it("renders with the terminal's resolved font instead of a pane-local stack", () => {
    render(<NeovimPane featureId={1} />);
    expect(celerittyTerminalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ font: RESOLVED_TERMINAL_OPTIONS.font }),
      }),
    );
  });

  it("resolves that font from the theme palette and the chosen Cadencr mono family", () => {
    render(<NeovimPane featureId={1} />);
    expect(terminalOptionsMock).toHaveBeenCalledWith({
      palette: expect.objectContaining({ background: "#000" }),
      fontFamily: '"JetBrainsMono Nerd Font", monospace',
    });
  });

  it("keeps a steady block cursor as the shape nvim starts from", () => {
    render(<NeovimPane featureId={1} />);
    expect(celerittyTerminalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ cursor: { style: "block", blink: false } }),
      }),
    );
  });

  it("surfaces a broken terminal configuration instead of rendering a silent blank pane", () => {
    terminalOptionsError = "alacritty.toml: expected a table";
    render(<NeovimPane featureId={1} />);
    expect(screen.getByText(/alacritty.toml: expected a table/)).toBeInTheDocument();
  });
});
