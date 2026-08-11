export interface TerminalCoreInstanceProps {
  featureId: number;
  projectId: number;
  existingPtyId?: string;
  requestedCwd?: string;
  onExit?: (ptyId: string) => void;
  onPtyReady?: (ptyId: string, cwd: string | null) => void;
  killOnUnmount?: boolean;
  initialCommand?: string;
  onInitialCommandConsumed?: () => void;
  initialNotice?: string;
  onInitialNoticeConsumed?: () => void;
  onTerminalFocus?: () => void;
  ctrlArmed?: boolean;
  onConsumeCtrl?: () => void;
}

export interface TerminalCoreInstanceHandle {
  focus: () => void;
  clearScreen: () => void;
  clearInput: () => void;
  blur: () => void;
  markForKill: () => void;
  write: (data: string) => void;
}
