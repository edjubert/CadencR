import type { StoreAccessors } from "./ws-envelope-types";
import { updateSession } from "./ws-session-types";

export function handleRuntimeOverridesChanged(
  ctx: StoreAccessors,
  sessionId: string,
  payload: unknown,
): void {
  if (!payload || typeof payload !== "object") return;
  const raw = (payload as { runtime_overrides?: unknown }).runtime_overrides;
  if (!raw || typeof raw !== "object") return;
  const value = raw as Record<string, unknown>;
  const model = value.model;
  const thinking = value.thinking_effort;
  const fast = value.fast_mode;
  if (model !== null && typeof model !== "string") return;
  if (thinking !== null && typeof thinking !== "string") return;
  if (fast !== null && typeof fast !== "boolean") return;
  const effective = (payload as { effective?: unknown }).effective;
  if (!effective || typeof effective !== "object") return;
  const effectiveValue = effective as Record<string, unknown>;
  const effectiveModel = effectiveValue.model;
  const effectiveThinking = effectiveValue.thinking_effort;
  const effectiveFast = effectiveValue.fast_mode;
  if (effectiveModel !== null && typeof effectiveModel !== "string") return;
  if (effectiveThinking !== null && typeof effectiveThinking !== "string") return;
  if (typeof effectiveFast !== "boolean") return;
  const current = ctx.get().sessions[sessionId]?.currentSelection;
  ctx.set(
    updateSession(ctx.get(), sessionId, {
      runtimeOverrides: { model, thinking_effort: thinking, fast_mode: fast },
      currentSelection: current
        ? { providerId: current.providerId, modelId: effectiveModel ?? "" }
        : null,
      currentThinkingEffort: effectiveThinking ?? undefined,
      fastMode: effectiveFast,
    }),
  );
}
