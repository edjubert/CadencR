import { useCallback, useMemo } from "react";

import type { PushForceMode } from "@/api/generated";
import { useAppHotkeys } from "@/hooks/useAppHotkeys";
import { PUSH_FORCE_MNEMONICS } from "./PushForceSelector";
import { useDialogSubmitShortcut } from "./useDialogSubmitShortcut";

interface PushDialogShortcutOptions {
  open: boolean;
  /** Whether the mode mnemonics apply — false once the push is streaming. */
  mnemonicsEnabled: boolean;
  onModeChange: (mode: PushForceMode) => void;
  onSubmitShortcut: () => void;
}

const MODE_BY_MNEMONIC = new Map<string, PushForceMode>(
  Object.entries(PUSH_FORCE_MNEMONICS).map(([mode, key]) => [key, mode as PushForceMode]),
);
const MNEMONIC_KEYS = [...MODE_BY_MNEMONIC.keys()];

/**
 * Dialog-local bindings; intentionally separate from the global registry
 * (same call as `useStashDialogShortcuts` — these bare mnemonics only make
 * sense while this dialog is on screen, so they are not customizable).
 *
 * Every mode owns a mnemonic, including the default `p`, so the selection is
 * always reachable in one keystroke rather than only escapable by mouse.
 */
export function usePushDialogShortcuts({
  open,
  mnemonicsEnabled,
  onModeChange,
  onSubmitShortcut,
}: PushDialogShortcutOptions): void {
  const mnemonicOptions = useMemo(
    () => ({ enabled: mnemonicsEnabled, preventDefault: true, stopPropagation: true }),
    [mnemonicsEnabled],
  );
  // Matched on `event.key` (not `event.code`) so the letters follow the
  // user's layout on non-QWERTY keyboards.
  const selectMode = useCallback(
    (event: KeyboardEvent) => {
      const mode = MODE_BY_MNEMONIC.get(event.key.toLowerCase());
      if (mode) onModeChange(mode);
    },
    [onModeChange],
  );

  useAppHotkeys(MNEMONIC_KEYS, selectMode, mnemonicOptions, [selectMode]);
  // Cmd/Ctrl+Enter stays live while running so it can background the push.
  useDialogSubmitShortcut({ open, onSubmit: onSubmitShortcut });
}
