import { ListOrdered } from "lucide-react";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import {
  AGENT_MESSAGE_NAVIGATOR_SETTING_KEY,
  parseAgentMessageNavigator,
} from "@/lib/agent-message-navigator";
import { formatCombo } from "@/lib/shortcuts/format";
import { useResolvedShortcut } from "@/lib/shortcuts/overrides";
import { SettingsSwitchRow } from "./SettingsSwitchRow";

/**
 * Settings → Interface row toggling the agent tab's message navigator: the
 * rail of ticks marking each of your prompts along the stream's right edge.
 * Defaults to on.
 */
export function AgentMessageNavigatorSetting(): React.JSX.Element {
  const setting = useDebouncedSetting(AGENT_MESSAGE_NAVIGATOR_SETTING_KEY, 0);
  // Resolved, not the registry defaults: the text follows a user's rebinding.
  const previousCombo = formatCombo(useResolvedShortcut("agent-previous-message").keys).join("");
  const nextCombo = formatCombo(useResolvedShortcut("agent-next-message").keys).join("");

  return (
    <SettingsSwitchRow
      divided
      icon={<ListOrdered className="size-4" />}
      iconTint="cyan"
      label="Message navigator"
      description={`Mark each of your messages with a small tick on the agent tab's right edge. Hover a tick to preview the message, click it to scroll there, or press ${previousCombo} / ${nextCombo}.`}
      checked={parseAgentMessageNavigator(setting.value)}
      onCheckedChange={(next) => setting.setValue(next ? "true" : "false")}
      disabled={setting.isLoading}
    />
  );
}
