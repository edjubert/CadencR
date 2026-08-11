import { useEffect, useRef, useState, useCallback } from "react";
import type { TerminalOptions, TerminalTransport } from "./cathode-term-stubs";
import { TerminalStub } from "./cathode-term-class";
import { TERMINAL_DEFAULTS } from "./terminal-defaults";

export interface UseCathodeTerminalOptions {
  hostRef: React.RefObject<HTMLDivElement | null>;
  options: TerminalOptions | undefined;
  transport: TerminalTransport | undefined;
}

export interface UseCathodeTerminalResult {
  terminal: TerminalStub | undefined;
  status: "loading" | "ready" | "error";
  errorMessage: string | null;
}

export function useCathodeTerminal(
  o: UseCathodeTerminalOptions,
): UseCathodeTerminalResult {
  const { hostRef, options, transport } = o;
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const terminalRef = useRef<TerminalStub | null>(null);
  const cancelledRef = useRef(false);
  const transportRef = useRef<TerminalTransport | undefined>(undefined);
  transportRef.current = transport;

  const createTerminal = useCallback((): TerminalStub | null => {
    const host = hostRef.current;
    if (!host || !options) return null;
    const terminal = new TerminalStub(host, {
      ...TERMINAL_DEFAULTS,
      ...options,
    });
    terminalRef.current = terminal;
    return terminal;
  }, [hostRef, options]);

  useEffect(() => {
    cancelledRef.current = false;
    const terminal = createTerminal();
    if (!terminal) return;

    let disposed = false;

    terminal
      .ready
      .then(() => {
        if (cancelledRef.current || disposed) return;
        const tr = transportRef.current;
        if (tr) {
          terminal.onData((data: string) => {
            if (cancelledRef.current) return;
            tr.write(new TextEncoder().encode(data));
          });
          terminal.onClose(() => {
            if (cancelledRef.current) return;
            setStatus("error");
            setErrorMessage("Terminal connection closed");
          });
        }
        if (!cancelledRef.current) {
          setStatus("ready");
        }
      })
      .catch((err: unknown) => {
        if (cancelledRef.current) return;
        const msg =
          err instanceof Error ? err.message : "WebGPU not available";
        setStatus("error");
        setErrorMessage(msg);
      });

    return () => {
      cancelledRef.current = true;
      disposed = true;
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [createTerminal, transport]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || !options) return;
    terminal.setOptions(options);
  }, [options]);

  return {
    terminal: terminalRef.current ?? undefined,
    status,
    errorMessage,
  };
}
