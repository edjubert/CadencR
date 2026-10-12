import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useGetAutoNamePrompt } from "@/api/generated";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import { useSyncedSettingInput } from "@/hooks/useSyncedSettingInput";
import { ErrorRow, LoadingRow } from "./SettingsStateRows";
import { SettingsSubsection } from "./SettingsSubsection";

/** Workspace key read by the backend; empty means "use the built-in prompt". */
const AUTO_NAME_SYSTEM_PROMPT_KEY = "auto_name_system_prompt";

/** What to persist for `text`: the built-in prompt (or nothing) is stored as
 *  empty, so a later improvement to the default still reaches the user. */
export function storedAutoNamePrompt(text: string, defaultPrompt: string): string {
  const trimmed = text.trim();
  return trimmed === "" || trimmed === defaultPrompt.trim() ? "" : text;
}

/**
 * Editable auto-naming system prompt. The field starts on the built-in prompt
 * so the user edits it rather than writing one from scratch; Reset returns to
 * it. The naming format instruction lives in the per-request message, so no
 * edit here can break title extraction.
 *
 * Saves on blur (and on unmount), not per keystroke: every write rewrites the
 * settings file, which refreshes settings-derived caches in every window.
 */
export function AutoNamePromptSetting(): React.JSX.Element {
  const defaultQuery = useGetAutoNamePrompt({ query: { staleTime: Infinity } });
  const setting = useDebouncedSetting(AUTO_NAME_SYSTEM_PROMPT_KEY, 0);
  const defaultPrompt = defaultQuery.data?.default_prompt;
  const stored = setting.value ?? "";
  const isCustom = stored.trim() !== "";
  const isReady = defaultPrompt !== undefined && !setting.isLoading;
  const input = useSyncedSettingInput(
    isReady ? (isCustom ? stored : defaultPrompt) : undefined,
    AUTO_NAME_SYSTEM_PROMPT_KEY,
  );

  const save = (): void => {
    if (defaultPrompt === undefined) return;
    const next = storedAutoNamePrompt(input.value, defaultPrompt);
    if (next !== stored) setting.setValue(next);
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => () => saveRef.current(), []);

  const reset = (): void => {
    if (defaultPrompt === undefined) return;
    input.setValue(defaultPrompt);
    setting.setValue("");
  };

  return (
    <SettingsSubsection
      title="Naming prompt"
      description={
        isCustom
          ? "Custom system prompt used to title new conversations."
          : "System prompt used to title new conversations (default)."
      }
      action={
        isCustom ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px]"
            aria-label="Reset naming prompt"
            onClick={reset}
          >
            Reset
          </Button>
        ) : null
      }
    >
      {defaultQuery.error ? (
        <ErrorRow label="Failed to load the default naming prompt." />
      ) : !isReady ? (
        <LoadingRow label="Loading naming prompt…" />
      ) : (
        <Textarea
          aria-label="Auto-naming system prompt"
          placeholder={defaultPrompt}
          rows={5}
          value={input.value}
          onChange={(event) => input.setValue(event.target.value)}
          onBlur={save}
          className="min-h-28 resize-y leading-relaxed"
        />
      )}
    </SettingsSubsection>
  );
}
