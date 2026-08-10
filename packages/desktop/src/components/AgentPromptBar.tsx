import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { AgentPromptPendingIndicator } from "./AgentPromptPendingIndicator";
import type { AgentPromptBarHandle, AgentPromptBarProps } from "./agent-prompt-bar-types";
import { AgentQuestionDrawer } from "./AgentQuestionDrawer";
import { ImageAttachmentPreview } from "./ImageAttachmentPreview";
import { PlanApprovalBar } from "./PlanApprovalBar";
import { PromptBarActions } from "./PromptBarActions";
import { PromptEditor } from "./prompt-editor/PromptEditor";
import { ReferencedWorktreeTip } from "./ReferencedWorktreeTip";
import { ShellCommandModeMarker } from "./ShellCommandModeMarker";
import { SplitSendActions } from "./SplitSendActions";
import { ToolPermissionPrompt } from "./ToolPermissionPrompt";
import {
  useAgentPromptBarController,
  type AgentPromptBarController,
} from "./useAgentPromptBarController";

export type { AgentPromptBarHandle, SplitSendAction } from "./agent-prompt-bar-types";

export const AgentPromptBar = forwardRef<AgentPromptBarHandle, AgentPromptBarProps>(
  function AgentPromptBar(props, ref) {
    const controller = useAgentPromptBarController(props, ref);
    return (
      <>
        <DeferredPromptIndicators props={props} controller={controller} />
        <SpecialPrompt props={props} controller={controller} />
        <PromptComposer props={props} controller={controller} />
      </>
    );
  },
);

function DeferredPromptIndicators({
  props,
  controller,
}: {
  props: AgentPromptBarProps;
  controller: AgentPromptBarController;
}) {
  return (
    <>
      {controller.special.permissionDeferred && props.pendingPermission && (
        <AgentPromptPendingIndicator kind="permission" detail={props.pendingPermission.toolName} />
      )}
      {controller.special.planApprovalDeferred && <AgentPromptPendingIndicator kind="plan" />}
      {controller.special.questionsDeferred && <AgentPromptPendingIndicator kind="question" />}
    </>
  );
}

function SpecialPrompt({
  props,
  controller,
}: {
  props: AgentPromptBarProps;
  controller: AgentPromptBarController;
}) {
  const special = controller.special;
  const content =
    special.visiblePermission && props.onPermissionDecision ? (
      <ToolPermissionPrompt
        key={
          special.visiblePermission.requestId ??
          `${special.visiblePermission.toolName}:${special.visiblePermission.pattern}`
        }
        permission={special.visiblePermission}
        onDecision={props.onPermissionDecision}
        onCancel={props.onGateClose}
        disableShortcuts={props.disableShortcuts}
        isSubmitting={!!props.isSubmittingPermission}
      />
    ) : special.visiblePlanApproval && props.onPlanApprove && props.onPlanRequestChanges ? (
      <PlanApprovalBar
        allowedPrompts={special.visiblePlanApproval.allowedPrompts}
        initialFeedback={controller.state.text}
        approveLabel={props.planApproveLabel}
        onApprove={props.onPlanApprove}
        onRequestChanges={props.onPlanRequestChanges}
        onReject={props.onGateClose ?? props.onPlanReject}
        error={props.planApprovalError}
      />
    ) : special.visibleQuestions?.length && props.onQuestionResponse ? (
      <AgentQuestionDrawer
        questions={special.visibleQuestions}
        open
        onSubmit={props.onQuestionResponse}
        onCancel={props.onGateClose}
        inline
        disableShortcuts={props.disableShortcuts}
      />
    ) : null;
  return content ? (
    <div data-permission-area={!!special.visiblePermission} data-question-area>
      {content}
    </div>
  ) : null;
}

function PromptComposer({
  props,
  controller,
}: {
  props: AgentPromptBarProps;
  controller: AgentPromptBarController;
}) {
  const { state } = controller;
  return (
    <div
      ref={state.wrapperRef}
      data-agent-prompt-bar="true"
      hidden={controller.special.hasSpecialState}
      aria-hidden={controller.special.hasSpecialState}
      className={cn(
        "flex min-h-0 flex-col px-3 pb-4",
        props.noTopPadding ? "pt-0" : "pt-3",
        "group-data-[agent-dragover]/agent-section:ring-2 group-data-[agent-dragover]/agent-section:ring-inset group-data-[agent-dragover]/agent-section:ring-primary/50",
      )}
      {...state.attachments.dragHandlers}
    >
      {state.attachments.attachments.length > 0 && (
        <ImageAttachmentPreview
          attachments={state.attachments.attachments}
          onRemove={state.attachments.removeAttachment}
          className="mb-2"
        />
      )}
      {props.referencedWorktreeSelection && props.projectId != null ? (
        <ReferencedWorktreeTip
          prompt={state.text}
          projectId={props.projectId}
          selection={props.referencedWorktreeSelection}
          agentTabActive={props.agentTabActive ?? true}
          shortcutsDisabled={props.disableShortcuts ?? false}
        />
      ) : null}
      <PromptSurface props={props} controller={controller} />
      {props.splitSendActions && !controller.isRunning && !controller.isShellCommandMode && (
        <SplitSendActions
          actions={props.splitSendActions}
          disabled={!controller.sending.canSend}
          onAction={controller.sending.handleSplitAction}
        />
      )}
    </div>
  );
}

function PromptSurface({
  props,
  controller,
}: {
  props: AgentPromptBarProps;
  controller: AgentPromptBarController;
}) {
  const { editorActions, sending, state } = controller;
  return (
    <div
      data-shell-command-mode={controller.isShellCommandMode || undefined}
      className="glass-surface flex max-h-[calc(var(--app-vh,100dvh)*0.4)] min-h-0 items-center gap-1.5 rounded-lg border border-transparent bg-muted/40 py-4 pl-4 pr-2.5 transition-colors focus-within:bg-muted/55"
      onClick={editorActions.handleSurfaceClick}
    >
      {controller.isShellCommandMode && (
        <ShellCommandModeMarker onClear={editorActions.clearShellCommandMode} />
      )}
      <PromptEditor
        ref={state.editorRef}
        onChange={editorActions.handleEditorChange}
        onEnterSend={sending.handleEnterSend}
        onArrowUp={editorActions.handleArrowUp}
        onArrowDown={editorActions.handleArrowDown}
        disabled={props.disabled || sending.sending}
        placeholder={
          props.status === "question"
            ? "Send a message to resume…"
            : `Send a message… (@ files, @@ conversations, ${controller.promptCommandHint})`
        }
        className="min-h-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-0 py-0 text-sm leading-[22px] shadow-none focus:border-0 focus:ring-0"
        mentionProjectId={props.projectId}
        mentionFeatureId={props.featureId}
        slashCommands={props.slashCommandsOverride}
        slashCommandsLoading={props.slashCommandsLoading}
        promptCommandPolicy={controller.promptCommandPolicy}
        onPasteImages={state.attachments.addFiles}
      />
      <PromptBarActions
        onAddFiles={state.attachments.addFiles}
        providerId={props.providerId}
        inputsDisabled={!!props.disabled || sending.sending || controller.isShellCommandMode}
        isRunning={controller.isRunning}
        onStop={props.onStop}
        onSend={sending.handleSend}
        canSend={sending.canSend}
        sending={sending.sending}
        showSendButton={
          (controller.isShellCommandMode || !props.splitSendActions) &&
          (!controller.isRunning || state.isMobile)
        }
        schedule={controller.isShellCommandMode ? undefined : sending.scheduleControl}
      />
    </div>
  );
}
