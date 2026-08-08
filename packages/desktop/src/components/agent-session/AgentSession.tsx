import { forwardRef, memo } from "react";
import { BranchConfirmDialog } from "./BranchConfirmDialog";
import { AgentSessionComposer } from "./AgentSessionComposer";
import { AgentSessionFrame } from "./AgentSessionFrame";
import { AgentSessionProvider } from "./agent-session-context";
import { AgentSessionStreamContent } from "./AgentSessionStreamContent";
import { shallowEqualSkipFunctions } from "./shallowEqualSkipFunctions";
import type { AgentSessionHandle, AgentSessionProps } from "./types";
import {
  useAgentSessionController,
  type AgentSessionController,
} from "./useAgentSessionController";

export const AgentSession = memo(
  forwardRef<AgentSessionHandle, AgentSessionProps>(function AgentSession(props, ref) {
    const controller = useAgentSessionController(props, ref);
    const { base } = controller;
    return (
      <AgentSessionProvider value={controller.contextValue}>
        {props.wsSessionId && <BranchConfirmDialog wsSessionId={props.wsSessionId} />}
        <AgentSessionFrame
          containerRef={base.containerRef}
          headerRef={base.headerRef}
          collapsible={props.collapsible ?? false}
          className={props.className}
          navAgentIndex={props.navAgentIndex}
          maximized={props.maximized}
          isOpen={base.isOpen}
          isIdle={base.isIdle}
          status={props.status}
          blocks={props.blocks}
          streamContent={<SessionStream props={props} controller={controller} />}
          bottomContent={<SessionComposer props={props} controller={controller} />}
          onToggle={base.handleToggle}
          IconComponent={base.IconComponent}
          badge={base.badge}
          displayLabel={base.displayLabel}
          onMarkDone={props.onMarkDone}
          resumable={props.resumable}
          onResume={props.onResume}
          canDelete={props.canDelete}
          onDelete={props.onDelete}
          onToggleMaximize={props.onToggleMaximize}
        />
      </AgentSessionProvider>
    );
  }),
  shallowEqualSkipFunctions,
);

function SessionStream({
  props,
  controller,
}: {
  props: AgentSessionProps;
  controller: AgentSessionController;
}) {
  const { base } = controller;
  return (
    <AgentSessionStreamContent
      blocks={props.blocks}
      rootBlocks={props.rootBlocks}
      toolResultMap={props.toolResultMap}
      isAgentWorking={base.isAgentWorking}
      turnActive={base.isTurnActive}
      lifecycle={base.streamLifecycle}
      workingLabel={base.workingLabel}
      projectPath={base.projectPath}
      scrollContainerRef={base.scroll.scrollContainerRef}
      virtuosoRef={base.scroll.virtuosoRef}
      followOutput={base.scroll.followOutput}
      onAtBottomStateChange={base.scroll.onAtBottomStateChange}
      onTotalListHeightChanged={base.scroll.onTotalListHeightChanged}
      onStartReached={base.scroll.onStartReached}
      isLoadingOlder={base.scroll.isLoadingOlder}
      historyPrependDisplayOffset={props.historyPrependDisplayOffset}
      verbosityMode={base.verbosityMode}
      summaryMode={base.summaryMode}
      searchEnabled={(props.agentTabActive ?? true) && !props.disableShortcuts}
    />
  );
}

function SessionComposer({
  props,
  controller,
}: {
  props: AgentSessionProps;
  controller: AgentSessionController;
}) {
  const { base, meta } = controller;
  return (
    <AgentSessionComposer
      sessionProps={props}
      promptBarRef={base.promptBarRef}
      metaBarRef={base.metaBarRef}
      onSend={meta.handleSend}
      onToggleAutoScroll={base.scroll.scrollToBottom}
      onCollapse={base.handleCollapse}
      shouldShowPromptBar={base.shouldShowPromptBar}
      hasMeta={meta.hasMeta}
      isNarrow={meta.isNarrow}
      hasSecondaryMeta={!!meta.hasSecondaryMeta}
      showAutoScrollChip={meta.showAutoScrollChip}
      autoScrollEnabled={base.scroll.autoScrollEnabled}
      showWorktreeChip={meta.showWorktreeChip}
      activeProviderId={meta.model.activeProviderId}
      currentModelLabel={meta.model.currentModelLabel ?? ""}
      modelSelectionStatus={meta.model.modelSelectionStatus}
      models={meta.model.visibleModels}
      providers={meta.visibleProviders}
      canChangeProvider={meta.model.canChangeProvider}
      supportedThinkingEfforts={meta.model.supportedThinkingEfforts}
      supportsFastMode={meta.model.supportsFastMode}
      isFastModePending={meta.isFastModePending}
      onFastModeChange={meta.handleFastModeChange}
      projectPath={base.projectPath}
      isAgentWorking={base.isAgentWorking}
      agentTabActive={props.agentTabActive ?? true}
      collapsible={props.collapsible ?? false}
      showClaudeProfileSelector={meta.showClaudeProfileSelector}
      claudeProfile={meta.profile.selectedClaudeProfile}
      claudeProfiles={meta.profile.claudeProfiles}
      claudeProfilesLoading={meta.profile.claudeProfilesLoading}
      claudeProfilesError={meta.profile.claudeProfilesError}
      activeClaudeProfile={meta.profile.activeClaudeProfile}
      onClaudeProfileChange={meta.profile.handleClaudeProfileChange}
    />
  );
}
