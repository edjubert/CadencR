import type { ReactElement } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import { LabeledControl } from "./LabeledControl";

export const AUTO_NAME_PROMPT_SETTING_KEY = "auto_name_system_prompt";

const MAX_PROMPT_LENGTH = 2000;

/**
 * System prompt used by the session auto-namer. Empty (or unset) means the
 * built-in default, so Reset clears the stored setting instead of restoring
 * a duplicated copy of the default text.
 */
export function AutoNamePromptSetting(): ReactElement {
  const { value, setValue, isLoading, isSaving } = useDebouncedSetting(
    AUTO_NAME_PROMPT_SETTING_KEY,
    500,
  );
  const currentValue = value ?? "";

  return (
    <LabeledControl
      label="Session naming prompt"
      hint={
        <span className="flex items-center justify-between gap-2">
          <span>
            {isSaving
              ? "Saving…"
              : "Empty uses the built-in default prompt for session auto-naming."}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 gap-1 px-1.5 text-[11px]"
            disabled={isLoading || isSaving || currentValue.length === 0}
            onClick={() => setValue("")}
          >
            <RotateCcw className="size-3" />
            Reset
          </Button>
        </span>
      }
    >
      <Textarea
        value={currentValue}
        maxLength={MAX_PROMPT_LENGTH}
        rows={3}
        disabled={isLoading}
        placeholder="Custom system prompt for the session auto-namer"
        onChange={(event) => setValue(event.target.value)}
      />
    </LabeledControl>
  );
}
