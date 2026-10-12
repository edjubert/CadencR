import { PanelTop, Sparkles } from "lucide-react";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import {
  NOTCH_ALWAYS_ANIMATE_KEY,
  NOTCH_ALWAYS_ON_KEY,
  useNotchPrefs,
} from "@/lib/notch/notch-prefs";
import { SettingsSwitchRow } from "./SettingsSwitchRow";

/** How the notch island behaves; rendered by `NotchSettings` while the notch is the destination. */
export function NotchBehaviorSettings(): React.JSX.Element {
  const prefs = useNotchPrefs();
  const alwaysOn = useDebouncedSetting(NOTCH_ALWAYS_ON_KEY, 0);
  const alwaysAnimate = useDebouncedSetting(NOTCH_ALWAYS_ANIMATE_KEY, 0);

  return (
    <>
      <SettingsSwitchRow
        icon={<PanelTop className="size-4" />}
        iconTint="cyan"
        label="Always on"
        description="Keep the island out beside the notch while agents work, wait for you, or have replies you haven't read. Off, it stays hidden until you hover the notch or an agent needs your attention."
        checked={prefs.alwaysOn}
        onCheckedChange={(next) => alwaysOn.setValue(String(next))}
        disabled={alwaysOn.isLoading}
      />
      <SettingsSwitchRow
        icon={<Sparkles className="size-4" />}
        iconTint="yellow"
        label="Always animate"
        description="Keep the logo moving while agents work, even with the island closed. Off, it only animates once the island opens."
        checked={prefs.alwaysAnimate}
        onCheckedChange={(next) => alwaysAnimate.setValue(String(next))}
        disabled={alwaysAnimate.isLoading}
        divided
      />
    </>
  );
}
