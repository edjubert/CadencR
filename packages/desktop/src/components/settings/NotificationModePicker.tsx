import { createElement, useMemo } from "react";
import { useNotchCapabilities } from "@/components/notch/useNotchCapabilities";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import {
  NOTIFICATION_MODE_KEY,
  NOTIFICATION_MODE_OPTIONS,
  parseNotificationMode,
  type NotificationMode,
} from "@/lib/notification-mode";
import { RadioCardGroup, type RadioCardOption } from "./RadioCardGroup";

/**
 * Destination picker (Notch / System / In app / Off) for agent-finished
 * notifications, persisted via `useDebouncedSetting` under
 * `NOTIFICATION_MODE_KEY`. Shared by the Settings → Notifications section and
 * the onboarding Preferences step so the option list and persistence stay in
 * one place. "Notch" only exists in the macOS desktop shell; a device that
 * can't host it still shows it when another device picked it, disabled.
 */
export function NotificationModePicker(): React.JSX.Element {
  const modeSetting = useDebouncedSetting(NOTIFICATION_MODE_KEY, 0);
  const mode = parseNotificationMode(modeSetting.value);
  const capabilities = useNotchCapabilities();
  const notchSupported = capabilities.data?.supported === true;
  const notchHardware = capabilities.data?.hardware === true;

  const options = useMemo<RadioCardOption<NotificationMode>[]>(
    () =>
      NOTIFICATION_MODE_OPTIONS.filter(
        (option) => option.value !== "notch" || notchSupported || mode === "notch",
      ).map((option) => ({
        value: option.value,
        label: option.label,
        description:
          option.value === "notch" && notchSupported && !notchHardware
            ? `${option.description} No notched display is connected right now, so a virtual notch sits at the top of your main screen.`
            : option.description,
        disabled: option.value === "notch" && !notchSupported,
        visual: createElement(option.icon, {
          className: "mt-0.5 size-4",
          style: { color: option.iconColorVar },
        }),
      })),
    [mode, notchHardware, notchSupported],
  );

  return (
    <RadioCardGroup<NotificationMode>
      ariaLabel="Notification destination"
      value={mode}
      onChange={modeSetting.setValue}
      options={options}
      layout="stack"
      showDot={false}
      disabled={modeSetting.isLoading || capabilities.isLoading}
    />
  );
}
