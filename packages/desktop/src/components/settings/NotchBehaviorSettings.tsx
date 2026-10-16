import { LoaderCircle, PanelTop, Sparkles } from "lucide-react";
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
  const alwaysOn = useDebouncedSetting(NOTCH_ALWAYS_ON_KEY, 0, { immediateCache: false });
  const alwaysAnimate = useDebouncedSetting(NOTCH_ALWAYS_ANIMATE_KEY, 0, { immediateCache: false });

  return (
    <>
      <SettingsSwitchRow
        icon={
          alwaysOn.isLoading || alwaysOn.isSaving ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <PanelTop className="size-4" />
          )
        }
        iconTint="cyan"
        label="Always on"
        description="Show compact activity while agents work, wait for you, or have unread replies. Off, it appears only on hover or for notifications. No status always hides compact activity on the primary display."
        checked={prefs.alwaysOn}
        onCheckedChange={(next) => alwaysOn.setValue(String(next))}
        disabled={alwaysOn.isLoading || alwaysOn.isSaving}
        divided
      />
      <SettingsSwitchRow
        icon={
          alwaysAnimate.isLoading || alwaysAnimate.isSaving ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Sparkles className="size-4" />
          )
        }
        iconTint="yellow"
        label="Always animate"
        description="Animate the logo and working indicators even with the island closed. Waiting and finished session dots stay still. Off, animations run only once the island opens."
        checked={prefs.alwaysAnimate}
        onCheckedChange={(next) => alwaysAnimate.setValue(String(next))}
        disabled={alwaysAnimate.isLoading || alwaysAnimate.isSaving}
        divided
      />
    </>
  );
}
