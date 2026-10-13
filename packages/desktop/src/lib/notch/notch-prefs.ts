import { useMemo } from "react";
import { useGetWorkspaceSetting } from "@/api/generated";
import { DEFAULT_NOTCH_PREFS, type NotchPrefs } from "@/shared/notch";

export const NOTCH_ALWAYS_ON_KEY = "notch_always_on";
export const NOTCH_ALWAYS_ANIMATE_KEY = "notch_always_animate";

function parseFlag(value: string | null | undefined, fallback: boolean): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

export function parseNotchPrefs(values: {
  alwaysOn: string | null | undefined;
  alwaysAnimate: string | null | undefined;
}): NotchPrefs {
  return {
    alwaysOn: parseFlag(values.alwaysOn, DEFAULT_NOTCH_PREFS.alwaysOn),
    alwaysAnimate: parseFlag(values.alwaysAnimate, DEFAULT_NOTCH_PREFS.alwaysAnimate),
  };
}

/** The user's notch island settings, with their defaults while unset. */
export function useNotchPrefs(): NotchPrefs {
  const alwaysOn = useGetWorkspaceSetting(NOTCH_ALWAYS_ON_KEY).data?.value;
  const alwaysAnimate = useGetWorkspaceSetting(NOTCH_ALWAYS_ANIMATE_KEY).data?.value;
  return useMemo(() => parseNotchPrefs({ alwaysOn, alwaysAnimate }), [alwaysAnimate, alwaysOn]);
}
