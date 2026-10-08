import { BotIcon, LoaderCircle } from "lucide-react";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import { SIDEBAR_PROVIDER_LOGOS_KEY } from "@/components/SidebarPreferences";
import { SettingsSwitchRow } from "./SettingsSwitchRow";

export function SidebarProviderLogosSetting() {
  const setting = useDebouncedSetting(SIDEBAR_PROVIDER_LOGOS_KEY, 0, { immediateCache: false });
  const busy = setting.isLoading || setting.isSaving;
  return (
    <SettingsSwitchRow
      divided
      icon={<BotIcon className="size-4" />}
      label={
        <span className="inline-flex items-center gap-1.5">
          Show provider logos
          {busy && (
            <LoaderCircle
              className="size-3.5 animate-spin"
              aria-label={
                setting.isSaving ? "Saving sidebar preference" : "Loading sidebar preference"
              }
            />
          )}
        </span>
      }
      description="Show the harness logo at the end of sidebar titles. Status indicators and keyboard hints stay visible when logos are hidden."
      checked={setting.value !== "false"}
      disabled={busy}
      onCheckedChange={(checked) => setting.setValue(String(checked))}
    />
  );
}
