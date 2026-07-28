import { useImperativeHandle } from "react";
import type { WorktreeMode } from "@/lib/worktree-mode";
import type { TodoItem } from "@/types/agent";
import type { ThinkingEffortLevel } from "@/shared/thinking-effort";
import type { AccessMode } from "@/types/access-mode";
import type { RuntimeProviderAccessModeOption } from "@/api/agentRuntime";
import type { ClaudeCodeProfile } from "@/api/agentRuntime";
import type { RuntimeSelection } from "@/shared/models";
import type { MetaBarHandle, MetaBarProps } from "./MetaBar";

export interface MetaBarInput {
  showAutoScrollChip: boolean;
  autoScrollEnabled: boolean;
  onToggleAutoScroll: () => void;
  providerAccessModes: readonly RuntimeProviderAccessModeOption[];
  accessModeDefault: AccessMode | undefined;
  isAccessModePending: boolean;
  onAccessModeChange: ((mode: AccessMode) => void) | undefined;
  showWorktreeChip: boolean;
  worktreeMode: WorktreeMode | undefined;
  onWorktreeModeChange: ((mode: WorktreeMode) => void) | undefined;
  worktreeProjectId: number | undefined;
  worktreeDefaultBranch: string | undefined;
  worktreeProjectPath: string | undefined;
  worktreeSelectedBranch: string | null | undefined;
  onWorktreeBranchChange: ((next: string | null) => void) | undefined;
  onProviderChange: ((providerId: string) => void) | undefined;
  onModelChange: ((providerId: string, modelId: string) => void) | undefined;
  currentThinkingEffort: ThinkingEffortLevel | undefined;
  supportedThinkingEfforts: ThinkingEffortLevel[];
  onThinkingEffortChange: ((thinkingEffort?: ThinkingEffortLevel) => void) | undefined;
  claudeProfile: string | undefined;
  claudeProfiles: ClaudeCodeProfile[];
  claudeProfilesLoading: boolean;
  claudeProfilesError: boolean;
  onClaudeProfileChange: ((profile: string) => void) | undefined;
  currentSelection: RuntimeSelection | null;
  canChangeProvider: boolean;
  todos: TodoItem[] | null | undefined;
  runtimeSessionId: string | undefined;
  featureId: number | undefined;
  wsSessionId: string | undefined;
  projectPath: string | undefined;
  isRunning: boolean;
  onPause: (() => void) | undefined;
  onModelSelected: (() => void) | undefined;
  secondaryBelow: boolean;
}

export function useMetaBarInput(props: MetaBarProps): MetaBarInput {
  return {
    showAutoScrollChip: props.showAutoScrollChip,
    autoScrollEnabled: props.autoScrollEnabled,
    onToggleAutoScroll: props.onToggleAutoScroll,
    providerAccessModes: props.providerAccessModes ?? [],
    accessModeDefault: props.accessModeDefault,
    isAccessModePending: props.isAccessModePending ?? false,
    onAccessModeChange: props.onAccessModeChange,
    showWorktreeChip: props.showWorktreeChip,
    worktreeMode: props.worktreeMode,
    onWorktreeModeChange: props.onWorktreeModeChange,
    worktreeProjectId: props.worktreeProjectId,
    worktreeDefaultBranch: props.worktreeDefaultBranch,
    worktreeProjectPath: props.worktreeProjectPath,
    worktreeSelectedBranch: props.worktreeSelectedBranch,
    onWorktreeBranchChange: props.onWorktreeBranchChange,
    onProviderChange: props.onProviderChange,
    onModelChange: props.onModelChange,
    currentThinkingEffort: props.currentThinkingEffort,
    supportedThinkingEfforts: props.supportedThinkingEfforts ?? [],
    onThinkingEffortChange: props.onThinkingEffortChange,
    claudeProfile: props.claudeProfile,
    claudeProfiles: props.claudeProfiles ?? [],
    claudeProfilesLoading: props.claudeProfilesLoading ?? false,
    claudeProfilesError: props.claudeProfilesError ?? false,
    onClaudeProfileChange: props.onClaudeProfileChange,
    currentSelection: props.currentSelection,
    canChangeProvider: props.canChangeProvider ?? false,
    todos: props.todos,
    runtimeSessionId: props.runtimeSessionId,
    featureId: props.featureId,
    wsSessionId: props.wsSessionId,
    projectPath: props.projectPath,
    isRunning: props.isRunning ?? false,
    onPause: props.onPause,
    onModelSelected: props.onModelSelected,
    secondaryBelow: props.secondaryBelow ?? false,
  };
}

export function useMetaBarForwardRef(
  ref: React.Ref<MetaBarHandle>,
  setInternalModelPickerOpen: (open: boolean) => void,
) {
  useImperativeHandle(
    ref,
    () => ({
      openModelPicker: () => setInternalModelPickerOpen(true),
    }),
    [],
  );
}

export interface MetaBarStyles {
  containerClassName: string;
  containerStyle: React.CSSProperties | undefined;
}

export function useMetaBarStyles(isStandalone: boolean): MetaBarStyles {
  return {
    containerClassName: isStandalone
      ? "flex items-center gap-1.5 px-3 py-2"
      : "flex items-center gap-1.5 relative -mt-6 px-3 py-3 backdrop-blur-sm",
    containerStyle: isStandalone
      ? undefined
      : {
          background:
            "linear-gradient(to bottom, transparent 0%, hsl(var(--background) / 0.05) 10%, hsl(var(--background) / 0.12) 20%, hsl(var(--background) / 0.25) 35%, hsl(var(--background) / 0.45) 50%, hsl(var(--background) / 0.65) 65%, hsl(var(--background) / 0.82) 80%, hsl(var(--background) / 0.93) 90%, hsl(var(--background)) 100%)",
        },
  };
}
