import { ModelSelector } from "@/components/ModelSelector";
import { AutoNamePromptSetting } from "./AutoNamePromptSetting";
import { SettingsCard } from "./SettingsCard";
import { SettingsSection } from "./SettingsSection";
import { SettingsSubsection } from "./SettingsSubsection";

const AUTO_NAME_ONLY = ["auto_name"] as const;

export function AutoNameSettingsSection(): React.JSX.Element {
  return (
    <SettingsSection
      id="auto-naming"
      title="Auto-naming"
      subtitle="Model & prompt"
      description="New conversations start on the model you last used — switch it from the composer."
    >
      <SettingsCard>
        <SettingsSubsection title="Naming model">
          <ModelSelector level="global" agentTypes={AUTO_NAME_ONLY} />
        </SettingsSubsection>
        <AutoNamePromptSetting />
      </SettingsCard>
    </SettingsSection>
  );
}
