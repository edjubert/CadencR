import { describe, it, expect, vi } from "vitest";
import { handleModelChange } from "./WebSocketSessionFeatureBlockTabs";
import type { useSessionControls } from "@/components/WebSocketSessionFeatureBlockHooks";

function makeControls(currentSelection: { providerId: string; modelId: string } | undefined) {
  const setProvider = vi.fn();
  const setModel = vi.fn();
  const setThinkingEffort = vi.fn();
  const controls = {
    ws: {
      currentSelection,
      setProvider,
      setModel,
      setThinkingEffort,
      currentThinkingEffort: undefined,
    },
    agentCatalog: { data: undefined },
    resolveModelThinkingEffort: vi.fn(() => undefined),
  } as unknown as ReturnType<typeof useSessionControls>;
  return { controls, setProvider, setModel };
}

describe("handleModelChange", () => {
  it("sends nothing when neither provider nor model changed", () => {
    const { controls, setProvider, setModel } = makeControls({
      providerId: "claude_code",
      modelId: "opus",
    });
    handleModelChange("claude_code", "opus", controls);
    expect(setProvider).not.toHaveBeenCalled();
    expect(setModel).not.toHaveBeenCalled();
  });

  it("sends setModel only when the provider is unchanged", () => {
    const { controls, setProvider, setModel } = makeControls({
      providerId: "claude_code",
      modelId: "opus",
    });
    handleModelChange("claude_code", "haiku", controls);
    expect(setProvider).not.toHaveBeenCalled();
    expect(setModel).toHaveBeenCalledWith("haiku", "claude_code");
  });

  it("sends setProvider only (with the target model) when the provider changes", () => {
    const { controls, setProvider, setModel } = makeControls({
      providerId: "claude_code",
      modelId: "opus",
    });
    handleModelChange("opencode", "opus", controls);
    expect(setModel).not.toHaveBeenCalled();
    expect(setProvider).toHaveBeenCalledWith("opencode", "opus");
  });

  it("sends setProvider only when both provider and model id happen to collide with another provider's model id", () => {
    const { controls, setProvider, setModel } = makeControls({
      providerId: "claude_code",
      modelId: "shared-id",
    });
    handleModelChange("opencode", "shared-id", controls);
    expect(setModel).not.toHaveBeenCalled();
    expect(setProvider).toHaveBeenCalledWith("opencode", "shared-id");
  });
});
