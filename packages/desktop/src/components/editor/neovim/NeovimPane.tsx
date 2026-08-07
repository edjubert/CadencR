import { memo, useCallback, useEffect, useRef } from "react";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/useTheme";
import { useNeovimEngine, encodeKey } from "./useNeovimEngine";
import { useNeovimWebSocket } from "./useNeovimWebSocket";

interface NeovimPaneProps {
  featureId: number;
}

/**
 * Full-frame Neovim panel: no `EditorSubTabs`, no tab/file-tree sync — Neovim
 * owns its own buffers entirely, per the level-3 design decision. Opening a
 * file from Cadencr's sidebar goes through a control-socket command (plan 4),
 * not through this pane's own state.
 */
function NeovimPane({ featureId }: NeovimPaneProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();

  const handleResize = useCallback(
    (grid: { columns: number; lines: number }) => {
      socket.resize(grid.columns, grid.lines);
    },
    // socket is defined below; declared with useRef-stable identity via useNeovimWebSocket's
    // own memoization, so this is safe to reference before its declaration at runtime (both
    // are set up in the same render, and the callback only executes after mount).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const engine = useNeovimEngine({
    canvasRef,
    surfaceRef,
    palette: theme.xterm,
    onResize: handleResize,
  });

  const socket = useNeovimWebSocket({
    featureId,
    onData: engine.feed,
    onAttached: engine.feed,
    onError: (message) => console.error("[neovim]", message),
  });

  useEffect(() => {
    socket.connect();
    return () => socket.detach();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featureId]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const bytes = encodeKey(
        event.key,
        event.ctrlKey,
        event.altKey,
        event.shiftKey,
        event.metaKey,
        engine.applicationCursor(),
      );
      if (bytes === undefined) return;
      event.preventDefault();
      socket.write(bytes);
    },
    [engine, socket],
  );

  if (engine.status === "error") {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 bg-background text-sm text-center px-6">
        <p className="text-destructive">Neovim could not start: {engine.errorMessage}</p>
      </div>
    );
  }

  if (engine.status !== "ready" || !socket.isConnected) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 bg-background">
        <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Connecting to Neovim…</p>
        <RestartAction featureId={featureId} onRestart={socket.connect} />
      </div>
    );
  }

  return (
    <div
      ref={surfaceRef}
      role="application"
      aria-label="Neovim editor"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="h-full w-full outline-none"
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}

function RestartAction({
  featureId,
  onRestart,
}: {
  featureId: number;
  onRestart: () => void;
}) {
  void featureId;
  return (
    <Button variant="outline" size="sm" onClick={onRestart}>
      Restart Neovim session
    </Button>
  );
}

export default memo(NeovimPane);
