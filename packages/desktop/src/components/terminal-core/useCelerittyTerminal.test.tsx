import { StrictMode, useRef } from "react";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalOptions, TerminalTransport } from "celeritty";
import { useCelerittyTerminal } from "./useCelerittyTerminal";

const mocks = vi.hoisted(() => ({
  warning: vi.fn(),
  instances: [] as Array<{
    ready: Promise<void>;
    resolve: () => void;
    reject: (error: Error) => void;
    attach: ReturnType<typeof vi.fn>;
    detach: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    setOptions: ReturnType<typeof vi.fn>;
    error: ((error: Error) => void) | undefined;
    diagnostic: ((error: Error) => void) | undefined;
  }>,
}));
vi.mock("sonner", () => ({ toast: { warning: mocks.warning } }));
vi.mock("./xterm-compatibility", () => ({
  XtermCompatibility: class {
    constructor() {
      throw new Error("Compatibility initialization failed");
    }
  },
}));
vi.mock("celeritty", () => ({
  createWebGpuRenderer: vi.fn(),
  Terminal: class {
    ready: Promise<void>;
    resolve!: () => void;
    reject!: (error: Error) => void;
    attach = vi.fn();
    detach = vi.fn();
    dispose = vi.fn();
    setOptions = vi.fn();
    error: ((error: Error) => void) | undefined;
    diagnostic: ((error: Error) => void) | undefined;
    constructor(host: HTMLElement) {
      // CeleriTTY 1.2 owns the native input; the host must not add a second one.
      const input = document.createElement("textarea");
      input.dataset.celerittyInput = "";
      host.appendChild(input);
      this.dispose.mockImplementation(() => input.remove());
      this.ready = new Promise((resolve, reject) => {
        this.resolve = resolve;
        this.reject = reject;
      });
      mocks.instances.push(this);
    }
    on(name: "error" | "diagnostic", callback: (error: Error) => void) {
      this[name] = callback;
      return () => {
        this[name] = undefined;
      };
    }
  },
}));
const options = {
  font: { family: "monospace", size: 13 },
  cursor: { style: "block", blink: false },
  colors: {},
  scrollback: 1000,
} as TerminalOptions;
const transport: TerminalTransport = {
  write: vi.fn(),
  resize: vi.fn(),
  onData: () => () => {},
  onClose: () => () => {},
};
function Harness({ config = options }: { config?: TerminalOptions }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const state = useCelerittyTerminal({ hostRef, options: config, transport });
  return (
    <>
      <div ref={hostRef} />
      <span>{state.status}</span>
      <p>{state.errorMessage}</p>
    </>
  );
}
beforeEach(() => {
  mocks.instances.length = 0;
  mocks.warning.mockClear();
});

describe("useCelerittyTerminal", () => {
  it("constructs once and attaches only after ready, updating options in place", async () => {
    const view = render(<Harness />);
    expect(mocks.instances).toHaveLength(1);
    const terminal = mocks.instances[0];
    expect(terminal.attach).not.toHaveBeenCalled();
    await act(async () => terminal.resolve());
    expect(view.getByText("ready")).toBeTruthy();
    expect(view.container.querySelectorAll("textarea")).toHaveLength(1);
    expect(view.container.querySelector("textarea")).toHaveAttribute("data-celeritty-input");
    view.rerender(<Harness config={{ ...options, scrollback: 2000 }} />);
    expect(mocks.instances).toHaveLength(1);
    expect(terminal.attach).toHaveBeenCalledTimes(1);
    expect(terminal.setOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ scrollback: 2000 }),
    );
    view.unmount();
    expect(terminal.dispose).toHaveBeenCalledTimes(1);
    expect(terminal.detach).toHaveBeenCalledTimes(1);
  });
  it("surfaces ready rejection without a second unhandled attach promise", async () => {
    const view = render(<Harness />);
    await act(async () => mocks.instances[0].reject(new Error("WebGPU unavailable")));
    expect(view.getByText("Compatibility initialization failed")).toBeTruthy();
    expect(mocks.instances[0].attach).not.toHaveBeenCalled();
  });
  it("ignores a stale initialization when StrictMode replaces its instance", async () => {
    const view = render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );
    expect(mocks.instances).toHaveLength(2);
    await act(async () => mocks.instances[0].reject(new Error("disposed")));
    await act(async () => mocks.instances[1].resolve());
    expect(view.getByText("ready")).toBeTruthy();
    expect(mocks.instances[0].dispose).toHaveBeenCalledTimes(1);
    expect(mocks.instances[0].attach).not.toHaveBeenCalled();
    expect(mocks.instances[1].attach).toHaveBeenCalledTimes(1);
    expect(view.container.querySelectorAll("textarea")).toHaveLength(1);
  });
  it("surfaces diagnostics without disposing the terminal and unsubscribes on unmount", async () => {
    const view = render(<Harness />);
    const terminal = mocks.instances[0];
    await act(async () => terminal.resolve());
    act(() => terminal.diagnostic?.(new Error("Transient frame failure")));
    expect(view.getByText("ready")).toBeTruthy();
    expect(terminal.dispose).not.toHaveBeenCalled();
    expect(mocks.warning).toHaveBeenCalledWith("Terminal rendering warning", {
      id: "terminal-renderer-diagnostic",
      description: "Transient frame failure",
    });
    view.unmount();
    expect(terminal.error).toBeUndefined();
    expect(terminal.diagnostic).toBeUndefined();
  });
  it("surfaces asynchronous renderer errors", async () => {
    const view = render(<Harness />);
    await act(async () => mocks.instances[0].resolve());
    act(() => mocks.instances[0].error?.(new Error("GPU device lost")));
    expect(view.getByText("GPU device lost")).toBeTruthy();
  });
});
