import { memo, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { Loader2Icon } from "lucide-react";
import type { TerminalOptions } from "celeritty";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/useTheme";
import { useCelerittyTerminal, useTerminalOptions } from "@/components/terminal-core";
import { useMonoFont } from "@/lib/fonts/mono-font-setting";
import { useNeovimWebSocket } from "./useNeovimWebSocket";
import { useNeovimTransport } from "./useNeovimTransport";

interface NeovimPaneProps {
  featureId: number;
}

/**
 * Full-frame Neovim panel: no `EditorSubTabs`, no tab/file-tree sync — Neovim
 * owns its own buffers entirely, per the level-3 design decision. Opening a
 * file from Cadencr's sidebar goes through a control-socket command (plan 4),
 * not through this pane's own state.
 *
 * Key/mouse encoding, scrollback, selection, links and the WebGPU draw loop
 * all live inside `Terminal` (`celeritty`) now — this pane only owns the
 * socket and the transport bridge, matching `TerminalCoreInstance`'s split
 * between socket ownership (per-consumer) and terminal lifecycle (shared,
 * via `useCelerittyTerminal`).
 */
function NeovimPane({ featureId }: NeovimPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const { theme } = useTheme();

  const socket = useNeovimWebSocket({
    featureId,
    onData: (bytes) => bridge.deliverData(bytes),
    onAttached: (bytes) => bridge.deliverSnapshot(bytes),
    onError: (message) => toast.error(message, { id: `neovim:${featureId}` }),
  });

  const bridge = useNeovimTransport(socket);

  useEffect(() => {
    socket.connect();
    return () => {
      socket.detach();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featureId]);

  // Same resolution as the Terminal tab (`useTerminalOptions`): the chosen
  // Cadencr mono family, else the user's alacritty.toml, else the default
  // stack. A pane-local font list here meant Neovim rendered in whatever
  // happened to be installed — dropping Nerd Font glyphs the terminal drew fine.
  const { family, resolved } = useMonoFont();
  const { options: terminalOptions, error: optionsError } = useTerminalOptions({
    palette: theme.xterm,
    fontFamily: family ? resolved : undefined,
  });

  const options = useMemo<TerminalOptions | undefined>(
    () =>
      terminalOptions && {
        ...terminalOptions,
        // Only the shape Neovim starts from: it re-declares its own cursor
        // per mode through DECSCUSR as soon as it draws.
        cursor: { style: "block", blink: false },
      },
    [terminalOptions],
  );

  const { status, errorMessage } = useCelerittyTerminal({
    hostRef,
    options,
    transport: socket.isConnected ? bridge.transport : undefined,
  });

  // Same derivation as `TerminalCoreInstance`: an unusable terminal
  // configuration is fatal, not pending. Left as "loading" the pane waits for
  // options that never arrive and offers a restart that only reconnects the
  // socket.
  const paneStatus = optionsError ? "error" : status;

  useEffect(() => {
    // Fatal for the rendering, not for the session: a dead renderer ends the
    // Neovim session, a bad config does not. `detach()` unregisters the
    // reconnector, so detaching here would leave the pane disconnected with no
    // automatic `connect()` once the file is repaired. Keeping the socket
    // attached is what makes that repair recover on its own, the service
    // re-pushes the config and `useTerminalOptions` re-resolves.
    if (status === "error") socket.detach();
  }, [status, socket.detach]);

  const error = errorMessage ?? optionsError ?? socket.lastError;
  // The host stays mounted in every non-fatal state: `Terminal` needs an
  // element to attach its canvas to, so gating it behind `status === "ready"`
  // would deadlock — no host, no engine, no ready. The loading state is an
  // overlay on top of the live host.
  return (
    <div className="relative h-full w-full">
      <div
        ref={hostRef}
        role="application"
        aria-label="Neovim editor"
        data-neovim-feature-id={featureId}
        className="relative h-full w-full outline-none"
      />
      {(paneStatus !== "ready" || !socket.isConnected || error) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background">
          {error ? (
            <p className="text-sm text-destructive">Neovim could not start: {error}</p>
          ) : (
            <>
              <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Connecting to Neovim…</p>
            </>
          )}
          {paneStatus !== "error" && <RestartAction onRestart={socket.connect} />}
        </div>
      )}
    </div>
  );
}

function RestartAction({ onRestart }: { onRestart: () => void }) {
  return (
    <Button variant="outline" size="sm" onClick={onRestart}>
      Restart Neovim session
    </Button>
  );
}

export default memo(NeovimPane);
