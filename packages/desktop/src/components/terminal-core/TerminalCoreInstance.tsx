import { forwardRef, useMemo } from "react";
import type {
  TerminalCoreInstanceProps,
  TerminalCoreInstanceHandle,
} from "./TerminalCoreInstance.types";
import { useTerminalCoreInstanceController } from "./useTerminalCoreInstanceController";
import { TerminalStub } from "./cathode-term-class";

export type { TerminalCoreInstanceHandle } from "./TerminalCoreInstance.types";

export const TerminalCoreInstance = forwardRef<
  TerminalCoreInstanceHandle,
  TerminalCoreInstanceProps
>(function TerminalCoreInstance(props, ref) {
  const { hostRef, status, isLoading, error, handle } =
    useTerminalCoreInstanceController(props, ref);

  const divRef = hostRef as React.RefObject<HTMLDivElement | null>;

  return (
    <div
      ref={divRef}
      className="relative h-full w-full"
      style={{
        backgroundColor: "var(--terminal-bg)",
        paddingLeft: 8,
        paddingRight: 8,
      }}
    >
      {status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-sm text-red-500">{error || "Terminal error"}</p>
        </div>
      )}
      {status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        </div>
      )}
    </div>
  );
},
);
