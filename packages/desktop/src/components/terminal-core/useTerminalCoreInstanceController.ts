import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ForwardedRef,
  type MutableRefObject,
} from "react";
import type { Terminal, TerminalTransport } from "celeritty";
import { useTerminalOptions } from "./useTerminalOptions";
import { useTerminalWebSocket } from "@/hooks/useTerminalWebSocket";
import { useCelerittyTransport } from "./useCelerittyTransport";
import { useCelerittyTerminal } from "./useCelerittyTerminal";
import { toControlChar } from "@/lib/terminal-keys";
import { useLinkRouting } from "@/components/links/LinkRoutingContext";
import { attachTouchScroll } from "./terminal-touch-scroll";
import { attachNavigationKeys } from "./terminal-navigation-keys";
import type { TerminalCoreInstanceProps, TerminalCoreInstanceHandle } from "./TerminalCoreInstance.types";

/** Fixed spawn size, matching the Neovim pane's own precedent: the PTY spawns
 * at a guessed size, and `Terminal.attach()` sends the real measured grid
 * immediately once attached — see `useCelerittyTerminal`. */
const INITIAL_COLUMNS = 80;
const INITIAL_ROWS = 24;

interface CoreRefs {
  ptyIdRef: MutableRefObject<string | null>;
  mountedRef: MutableRefObject<boolean>;
  shouldKillRef: MutableRefObject<boolean>;
  initialCommandRef: MutableRefObject<string | undefined>;
  onInitialCommandConsumedRef: MutableRefObject<(() => void) | undefined>;
  initialNoticeRef: MutableRefObject<string | undefined>;
  onInitialNoticeConsumedRef: MutableRefObject<(() => void) | undefined>;
  ctrlArmedRef: MutableRefObject<boolean>;
  onConsumeCtrlRef: MutableRefObject<(() => void) | undefined>;
  onTerminalFocusRef: MutableRefObject<(() => void) | undefined>;
  noticeConsumedRef: MutableRefObject<boolean>;
  commandConsumedRef: MutableRefObject<boolean>;
}

function useCoreRefs(props: TerminalCoreInstanceProps): CoreRefs {
  const stableRefsRef = useRef<CoreRefs | null>(null);
  stableRefsRef.current ??= {
    ptyIdRef: { current: props.existingPtyId ?? null },
    mountedRef: { current: true },
    shouldKillRef: { current: props.killOnUnmount ?? false },
    initialCommandRef: { current: props.initialCommand },
    onInitialCommandConsumedRef: { current: props.onInitialCommandConsumed },
    initialNoticeRef: { current: props.initialNotice },
    onInitialNoticeConsumedRef: { current: props.onInitialNoticeConsumed },
    ctrlArmedRef: { current: props.ctrlArmed ?? false },
    onConsumeCtrlRef: { current: props.onConsumeCtrl },
    onTerminalFocusRef: { current: props.onTerminalFocus },
    noticeConsumedRef: { current: false },
    commandConsumedRef: { current: false },
  };
  const refs = stableRefsRef.current;

  refs.shouldKillRef.current = props.killOnUnmount ?? false;
  refs.initialCommandRef.current = props.initialCommand;
  refs.onInitialCommandConsumedRef.current = props.onInitialCommandConsumed;
  refs.initialNoticeRef.current = props.initialNotice;
  refs.onInitialNoticeConsumedRef.current = props.onInitialNoticeConsumed;
  refs.ctrlArmedRef.current = props.ctrlArmed ?? false;
  refs.onConsumeCtrlRef.current = props.onConsumeCtrl;
  refs.onTerminalFocusRef.current = props.onTerminalFocus;

  return refs;
}

interface ShellSocket {
  connection: ReturnType<typeof useTerminalWebSocket>;
  transport: TerminalTransport;
  ptyReady: boolean;
}

/**
 * Owns the socket and the `TerminalTransport` built on top of it. Split out
 * of the controller purely to stay under the 100-line function budget — the
 * two pieces are read together everywhere they're used.
 */
function useShellSocket(props: TerminalCoreInstanceProps, refs: CoreRefs): ShellSocket {
  const [ptyReady, setPtyReady] = useState(false);

  const connection = useTerminalWebSocket({
    featureId: props.featureId,
    projectId: props.existingPtyId ? undefined : props.projectId,
    ptyId: props.existingPtyId,
    requestedCwd: props.requestedCwd,
    onData: (data) => {
      if (!refs.mountedRef.current) return;
      bridge.deliverData(data);
    },
    onReady: (ptyId, cwd) => {
      if (!refs.mountedRef.current) {
        connection.kill();
        return;
      }
      refs.ptyIdRef.current = ptyId;
      props.onPtyReady?.(ptyId, cwd);
      setPtyReady(true);
    },
    onExit: (code) => {
      if (!refs.mountedRef.current) return;
      bridge.deliverClose(`exited (${code})`);
      const id = refs.ptyIdRef.current;
      if (id) props.onExit?.(id);
    },
    onReconnected: () => {
      // Reconnect handling stays in the socket hook — the scrollback replay
      // it carries never crosses the TerminalTransport boundary.
    },
    onError: (message) => {
      if (!refs.mountedRef.current) return;
      bridge.deliverClose(message);
    },
  });

  const bridge = useCelerittyTransport(connection);

  // Ctrl-arm interception lives here, on the outbound (write) side — not on
  // useTerminalWebSocket's `onData`, which is PTY output arriving, the wrong
  // direction. `Terminal.attach()` already forwards every keystroke to
  // `transport.write()` automatically; wrapping `write` is the one hook point
  // that doesn't also require subscribing to the terminal's own "data" event
  // a second time, which would send every keystroke twice.
  const transport = useMemo<TerminalTransport>(
    () => ({
      ...bridge.transport,
      write(bytes: Uint8Array) {
        if (refs.ctrlArmedRef.current) {
          const text = new TextDecoder().decode(bytes);
          const control = toControlChar(text);
          refs.onConsumeCtrlRef.current?.();
          bridge.transport.write(new TextEncoder().encode(control ?? text));
          return;
        }
        bridge.transport.write(bytes);
      },
    }),
    [bridge, refs.ctrlArmedRef, refs.onConsumeCtrlRef],
  );

  return { connection, transport, ptyReady };
}

/**
 * Routes `link-activate`/`link-hover` through `LinkRoutingContext` — the
 * same policy (internal vs. default browser, native context-menu hover
 * state) `XTermInstance` fed via `@xterm/addon-web-links`. `celeritty`
 * only detects and reports; it never opens a link itself.
 *
 * Split out to stay under the 100-line function budget.
 */
function useLinkRoutingWiring(terminal: Terminal | undefined): void {
  const linkRouting = useLinkRouting();
  const linkRoutingRef = useRef(linkRouting);
  linkRoutingRef.current = linkRouting;

  useEffect(() => {
    if (!terminal) return;
    const offActivate = terminal.on("link-activate", ({ url, modifiers }) => {
      // Matches XTermInstance's WebLinksAddon gating: a plain click is a
      // click, not an "open this" — only Cmd/Ctrl+Click activates.
      if (modifiers.meta || modifiers.ctrl) linkRoutingRef.current?.activate(url);
    });
    const offHover = terminal.on("link-hover", (url) => {
      linkRoutingRef.current?.setHoverLink(url);
    });
    return () => {
      offActivate();
      offHover();
      linkRoutingRef.current?.setHoverLink(null);
    };
  }, [terminal]);
}

export function useTerminalCoreInstanceController(
  props: TerminalCoreInstanceProps,
  ref: ForwardedRef<TerminalCoreInstanceHandle>,
) {
  const refs = useCoreRefs(props);
  const hostRef = useRef<HTMLDivElement | null>(null);

  const { options, isLoading, error } = useTerminalOptions();
  const { connection, transport, ptyReady } = useShellSocket(props, refs);

  const { terminal, status, errorMessage } = useCelerittyTerminal({
    hostRef,
    options,
    // Held back until the PTY is confirmed spawned: `Terminal.attach()`
    // immediately sends the current grid size through `transport.resize()`,
    // and that call is silently dropped if the socket isn't open yet — see
    // `useTerminalWebSocket`'s `resize`. Passing `undefined` until then keeps
    // `useCelerittyTerminal` from attaching too early.
    transport: ptyReady ? transport : undefined,
  });

  useLinkRoutingWiring(terminal);

  // Touch scrolling and the Cmd+arrow line-navigation keys were provided by
  // xterm.js addons; celeritty has neither (no touch handling at all, and it
  // drops Meta-held keys by design). Both are ported rather than dropped —
  // see each module for what carried over and what did not.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !terminal) return;
    const detachTouch = attachTouchScroll(host, terminal);
    const detachKeys = attachNavigationKeys(host, {
      isActive: () => refs.ptyIdRef.current !== null,
      write: (data) => connection.write(data),
    });
    return () => {
      detachTouch();
      detachKeys();
    };
  }, [terminal, connection, refs]);

  // Spawn the PTY once, at the fixed default size. `Terminal.attach()`
  // corrects it to the real measured grid as soon as it attaches.
  useEffect(() => {
    connection.connect(INITIAL_COLUMNS, INITIAL_ROWS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // `XTermInstance` reported focus via xterm's inner textarea; `Terminal`
  // has no such child — its host element is the tabindex target itself
  // (set in the `Terminal` constructor), so a native `focus` listener on it
  // is the direct equivalent. This is what `TerminalPortals` uses to track
  // which split pane is active for keyboard-shortcut routing.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onFocus = (): void => refs.onTerminalFocusRef.current?.();
    host.addEventListener("focus", onFocus);
    return () => host.removeEventListener("focus", onFocus);
  }, [refs]);

  // Flush the initial notice/command once both the PTY and the terminal are
  // ready. The notice is a local write (never reaches the shell); the
  // command is sent through the transport (reaches the shell, once).
  useEffect(() => {
    if (!terminal || !ptyReady) return;

    const notice = refs.initialNoticeRef.current;
    if (notice && !refs.noticeConsumedRef.current) {
      refs.noticeConsumedRef.current = true;
      terminal.write(`\x1b[90m→ cd ${notice}\x1b[0m\r\n`);
      refs.onInitialNoticeConsumedRef.current?.();
    }

    const command = refs.initialCommandRef.current;
    if (command && !refs.commandConsumedRef.current) {
      refs.commandConsumedRef.current = true;
      const timer = setTimeout(() => {
        if (refs.mountedRef.current) connection.write(command);
        refs.onInitialCommandConsumedRef.current?.();
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [terminal, ptyReady, connection, refs]);

  const handleRef = useRef<TerminalCoreInstanceHandle | null>(null);
  const setHandle = useCallback(
    (t: typeof terminal) => {
      handleRef.current = {
        focus: () => t?.focus(),
        clearScreen: () => t?.clearScreen(),
        // Sends Ctrl+U to the process, not through terminal.write — clearing
        // the line is a shell action, not a local display change.
        clearInput: () => connection.write("\x15"),
        blur: () => t?.blur(),
        markForKill: () => {
          refs.shouldKillRef.current = true;
        },
        // Local injection — never reaches the shell. Used for initialNotice.
        write: (data: string) => t?.write(data),
      };
    },
    [connection, refs],
  );

  useEffect(() => {
    setHandle(terminal);
    if (ref && typeof ref !== "function") {
      (ref as MutableRefObject<TerminalCoreInstanceHandle | null>).current = handleRef.current;
    } else if (typeof ref === "function") {
      ref(handleRef.current);
    }
  }, [terminal, ref, setHandle]);

  useEffect(
    () => () => {
      refs.mountedRef.current = false;
      if (refs.ptyIdRef.current && refs.shouldKillRef.current) {
        connection.kill();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return useMemo(
    () => ({
      hostRef,
      status,
      isLoading,
      error: error ?? errorMessage,
    }),
    [status, isLoading, error, errorMessage],
  );
}
