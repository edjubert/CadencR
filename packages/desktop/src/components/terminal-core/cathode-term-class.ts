/**
 * Stub Terminal class for `cathode-term`.
 *
 * `cathode-term` is a planned package wrapping `@xterm/xterm` with WebGPU
 * rendering. Until it exists, this stub lets the terminal-core module
 * compile and type-check. It mirrors the xterm.js API surface used by
 * the cathode hooks.
 */

import type { XTermPalette } from "@/lib/themes";
import type {
  TerminalOptions,
  TerminalTransport,
  Terminal,
  Disposable,
} from "./cathode-term-stubs";

interface TerminalEventCallbacks {
  dataCallbacks: Array<(data: string) => void>;
  closeCallbacks: Array<() => void>;
}

export class TerminalStub implements Omit<Terminal, "ready"> {
  private parent?: HTMLDivElement;
  private options: TerminalOptions;
  private callbacks: TerminalEventCallbacks = {
    dataCallbacks: [],
    closeCallbacks: [],
  };
  private disposed = false;
  private _cols = 80;
  private _rows = 24;

  // Resolve immediately for stub — real impl waits for WebGPU
  private readyResolver = () => {};
  private readyRejector = () => {};

  readonly ready: Promise<void>;

  constructor(parent: HTMLDivElement, options: TerminalOptions) {
    this.parent = parent;
    this.options = options;
    this.ready = new Promise((resolve, reject) => {
      this.readyResolver = resolve;
      this.readyRejector = reject;
    });
    // Resolve immediately in stub (WebGPU check deferred to real impl)
    this.readyResolver();
  }

  get element(): HTMLDivElement | undefined {
    return this.parent;
  }

  get cols(): number {
    return this._cols;
  }

  get rows(): number {
    return this._rows;
  }

  open(parent: HTMLDivElement): void {
    this.parent = parent;
  }

  loadAddon(_addon: unknown): void {
    // No-op in stub
  }

  setOptions(options: Partial<TerminalOptions>): void {
    this.options = { ...this.options, ...options };
  }

  write(data: string): void {
    for (const cb of [...this.callbacks.dataCallbacks]) {
      cb(data);
    }
  }

  focus(): void {
    // No-op in stub
  }

  blur(): void {
    // No-op in stub
  }

  clearScreen(): void {
    // No-op in stub
  }

  onData(callback: (data: string) => void): Disposable {
    this.callbacks.dataCallbacks.push(callback);
    return {
      dispose: () => {
        const idx = this.callbacks.dataCallbacks.indexOf(callback);
        if (idx !== -1) this.callbacks.dataCallbacks.splice(idx, 1);
      },
    };
  }

  onClose(callback: () => void): () => void {
    this.callbacks.closeCallbacks.push(callback);
    return () => {
      const idx = this.callbacks.closeCallbacks.indexOf(callback);
      if (idx !== -1) this.callbacks.closeCallbacks.splice(idx, 1);
    };
  }

  dispose(): void {
    this.disposed = true;
    this.callbacks.dataCallbacks = [];
    this.callbacks.closeCallbacks = [];
    this.parent = undefined;
  }
}

export type { TerminalOptions, TerminalTransport, Disposable };
