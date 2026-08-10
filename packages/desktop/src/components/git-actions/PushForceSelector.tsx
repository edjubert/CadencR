/**
 * Force-mode picker for the push dialog.
 *
 * Built on the shared {@link RadioCardGroup} so it reads identically to the
 * Merge and Update pickers — same card chrome, same radio dot, same
 * description type scale. Every mode carries a one-key mnemonic badge, and
 * the resolved `git push` argv is rendered once below the group rather than
 * as one card's description: the three modes then share one grammar
 * (label + consequence) instead of mixing a command with prose, and the
 * line matches what the terminal pane echoes when the push starts.
 */
import { memo, type ReactElement } from "react";

import { PushForceMode } from "@/api/generated";
import { KbdShortcut } from "@/components/KbdShortcut";
import { RadioCardGroup, type RadioCardOption } from "@/components/settings/RadioCardGroup";

/** Dialog-local mnemonic for each mode, also rendered as its badge. */
export const PUSH_FORCE_MNEMONICS: Readonly<Record<PushForceMode, string>> = {
  [PushForceMode.none]: "p",
  [PushForceMode["force-with-lease"]]: "l",
  [PushForceMode.force]: "f",
};

function label(text: string, mode: PushForceMode): ReactElement {
  return (
    <span className="flex items-center gap-2">
      {text}
      <KbdShortcut keys={[PUSH_FORCE_MNEMONICS[mode]]} variant="hint" />
    </span>
  );
}

/**
 * Static: the data never depends on props, so building it once keeps the
 * `options` reference stable across the dialog's streaming re-renders.
 */
const PUSH_FORCE_OPTIONS: ReadonlyArray<RadioCardOption<PushForceMode>> = [
  {
    value: PushForceMode.none,
    label: label("Push", PushForceMode.none),
    description: "Fails if the remote has commits you don't have.",
  },
  {
    value: PushForceMode["force-with-lease"],
    label: label("Force with lease", PushForceMode["force-with-lease"]),
    description: "Overwrites the remote branch, but refuses if it moved since your last fetch.",
  },
  {
    value: PushForceMode.force,
    label: label("Force", PushForceMode.force),
    description: "Overwrites the remote branch unconditionally. Remote-only commits are lost.",
  },
];

/**
 * The exact command the backend will run for this mode. Mirrors
 * `push_args` in `packages/service/src/domain/git/commands/pty.rs` — keep
 * the two in step; the backend echoes this same string as the first line of
 * the terminal pane, so a drift is visible the moment a push starts.
 */
export function pushCommandLine(force: PushForceMode): string {
  const flag =
    force === PushForceMode.force
      ? " --force"
      : force === PushForceMode["force-with-lease"]
        ? " --force-with-lease"
        : "";
  return `git push -u${flag} origin HEAD`;
}

interface PushForceSelectorProps {
  value: PushForceMode;
  onChange: (mode: PushForceMode) => void;
}

export const PushForceSelector = memo(function PushForceSelector({
  value,
  onChange,
}: PushForceSelectorProps): ReactElement {
  return (
    <div className="space-y-2">
      <RadioCardGroup<PushForceMode>
        ariaLabel="Push mode"
        value={value}
        onChange={onChange}
        options={PUSH_FORCE_OPTIONS}
      />
      <p className="px-0.5 font-mono text-[11px] text-muted-foreground">
        <span aria-hidden>$ </span>
        {pushCommandLine(value)}
      </p>
    </div>
  );
});
