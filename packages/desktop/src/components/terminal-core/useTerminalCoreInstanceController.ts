import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ForwardedRef,
  type MutableRefObject,
} from "react";
import { useTerminalOptions } from "./useTerminalOptions";
import { useTerminalWebSocket } from "@/hooks/useTerminalWebSocket";
import { useCathodeTransport } from "./useCathodeTransport";
import { useCathodeTerminal } from "./useCathodeTerminal";
import { TerminalStub } from "./cathode-term-class";
import { toControlChar } from "@/lib/terminal-keys";
import type {
  TerminalCoreInstanceProps,
  TerminalCoreInstanceHandle,
} from "./TerminalCoreInstance.types";

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
  pendingFocusRef: MutableRefObject<boolean>;
  noticeConsumedRef: MutableRefObject<boolean>;
}

function useCoreRefs(props: TerminalCoreInstanceProps): CoreRefs {
  const ptyIdRef = useRef<string | null>(props.existingPtyId ?? null);
  const mountedRef = useRef(true);
  const shouldKillRef = useRef(props.killOnUnmount ?? false);
  const initialCommandRef = useRef(props.initialCommand);
  const onInitialCommandConsumedRef = useRef(props.onInitialCommandConsumed);
  const initialNoticeRef = useRef(props.initialNotice);
  const onInitialNoticeConsumedRef = useRef(props.onInitialNoticeConsumed);
  const ctrlArmedRef = useRef(props.ctrlArmed ?? false);
  const onConsumeCtrlRef = useRef(props.onConsumeCtrl);
  const pendingFocusRef = useRef(false);
  const noticeConsumedRef = useRef(false);

  const stableRefsRef = useRef<CoreRefs | null>(null);
  stableRefsRef.current ??= {
    ptyIdRef,
    mountedRef,
    shouldKillRef,
    initialCommandRef,
    onInitialCommandConsumedRef,
    initialNoticeRef,
    onInitialNoticeConsumedRef,
    ctrlArmedRef,
    onConsumeCtrlRef,
    pendingFocusRef,
    noticeConsumedRef,
  };
  const stableRefs = stableRefsRef.current;

  stableRefs.shouldKillRef.current = props.killOnUnmount ?? false;
  stableRefs.initialCommandRef.current = props.initialCommand;
  stableRefs.onInitialCommandConsumedRef.current = props.onInitialCommandConsumed;
  stableRefs.initialNoticeRef.current = props.initialNotice;
  stableRefs.onInitialNoticeConsumedRef.current = props.onInitialNoticeConsumed;
  stableRefs.ctrlArmedRef.current = props.ctrlArmed ?? false;
  stableRefs.onConsumeCtrlRef.current = props.onConsumeCtrl;

  return stableRefs;
}

export function useTerminalCoreInstanceController(
  props: TerminalCoreInstanceProps,
  ref: ForwardedRef<TerminalCoreInstanceHandle>,
) {
  const refs = useCoreRefs(props);
  const hostRef = useRef<HTMLDivElement | null>(null);

  // Options hook
  const { options, isLoading, error } = useTerminalOptions();

  // WebSocket connection (shell-specific)
  const connection = useTerminalWebSocket({
    featureId: props.featureId,
    projectId: props.existingPtyId ? undefined : props.projectId,
    ptyId: props.existingPtyId,
    requestedCwd: props.requestedCwd,
    onData: (data: string) => {
      if (!refs.mountedRef.current) return;
      // Ctrl interception: transform printable bytes when armed.
      // The transport adapter forwards data events from the terminal.
      // If we also subscribed here, keystrokes would be sent twice.
      // So we transform before the transport sees them.
      if (refs.ctrlArmedRef.current) {
        const control = toControlChar(data);
        if (control) {
          refs.onConsumeCtrlRef.current?.();
          connection.write(control);
          return;
        }
      }
      connection.write(data);
    },
    onReady: (ptyId: string, cwd: string) => {
      if (!refs.mountedRef.current) {
        connection.kill();
        return;
      }
      refs.ptyIdRef.current = ptyId;
      props.onPtyReady?.(ptyId, cwd);

      // Initial notice: write locally (not to socket)
      const notice = refs.initialNoticeRef.current;
      if (notice && !refs.noticeConsumedRef.current) {
        refs.noticeConsumedRef.current = true;
        refs.onInitialNoticeConsumedRef.current?.();
      }

      // Initial command: write to socket once
      const command = refs.initialCommandRef.current;
      if (command) {
        setTimeout(() => {
          if (refs.mountedRef.current && refs.ptyIdRef.current) {
            connection.write(command);
          }
          refs.onInitialCommandConsumedRef.current?.();
        }, 150);
      }
    },
    onExit: (code: number) => {
      if (!refs.mountedRef.current) return;
      const id = refs.ptyIdRef.current;
      if (id) props.onExit?.(id);
    },
    onReconnected: (_scrollback: string, _alive: boolean, _cwd: string | null) => {
      // Reconnect handling stays in the socket hook
    },
    onError: (_message: string) => {
      // Error handling stays in the socket hook
    },
  });

  // Transport adapter
  const transport = useCathodeTransport(connection);

  // Shared lifecycle
  const { terminal, status, errorMessage } = useCathodeTerminal({
    hostRef: { current: hostRef.current },
    options,
    transport,
  });

  // Imperative handle
  const handleRef = useRef<TerminalCoreInstanceHandle>(null);
  if (ref && !handleRef.current) {
    const stub = terminal as TerminalStub | undefined;
    handleRef.current = {
      focus: () => {
        refs.pendingFocusRef.current = true;
        stub?.focus();
      },
      clearScreen: () => {
        stub?.clearScreen();
      },
      clearInput: () => {
        // Send Ctrl+U to the socket, not through terminal.write
        connection.write("\x15"); // Ctrl+U
      },
      blur: () => {
        stub?.blur();
      },
      markForKill: () => {
        refs.shouldKillRef.current = true;
      },
      write: (data: string) => {
        // Local injection — does NOT reach the shell
        // Used for initialNotice
        stub?.write(data);
      },
    };
  }

  useEffect(() => {
    if (ref) {
      (ref as React.MutableRefObject<TerminalCoreInstanceHandle | null>).current =
        handleRef.current;
    }
  }, [ref]);

  // Kill on unmount
  useEffect(
    () => () => {
      refs.mountedRef.current = false;
      if (refs.ptyIdRef.current && refs.shouldKillRef.current) {
        connection.kill();
      }
    },
    [connection],
  );

  return useMemo(
    () => ({
      hostRef,
      status,
      isLoading,
      error: error ?? errorMessage,
      handle: handleRef.current,
    }),
    [hostRef, status, isLoading, error, errorMessage, handleRef],
  );
}
