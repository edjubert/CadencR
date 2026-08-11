import { useEffect, useRef, useState, useCallback } from "react";
import {
  useAlacrittyConfigRoute,
  type AlacrittyConfigResponse,
} from "@/api/generated";
import {
  readPersistedTheme,
} from "@/lib/themes";
import { useConnectionStatusStore } from "@/stores/connection-status-store";
import type {
  TerminalOptions,
  TerminalColorsConfig,
} from "./cathode-term-stubs";

export interface UseTerminalOptionsResult {
  options: TerminalOptions | undefined;
  isLoading: boolean;
  error: string | null;
}

function mergeTerminalOptions(
  response: AlacrittyConfigResponse,
  fontOverride: { family: string; size: number } | null,
): TerminalOptions {
  const config = response.config;
  const result: TerminalOptions = {
    bellStyle: (config.colors?.normal ? "sound" : "none") as "none" | "sound",
    cursorBlink: false,
    cursorStyle: "block" as const,
    cursorWidth: 2,
    scrollback: 5000,
    fontSize: 13,
    fontFamily:
      "'FiraCode Nerd Font', 'Fira Code', 'CaskaydiaCove Nerd Font', 'Cascadia Code', 'SF Mono', Menlo, Monaco, 'Courier New', monospace",
    fontWeight: "400",
    fontWeightBold: "600",
    letterSpacing: 0,
    lineHeight: 1.2,
    allowTransparency: true,
    macOptionIsMeta: true,
  };

  if (config.font) {
    result.fontFamily = config.font.normal?.family || result.fontFamily;
    result.fontSize = config.font.size || result.fontSize;
  }

  if (config.colors) {
    const mappedColors: TerminalColorsConfig = {};
    for (const [key, value] of Object.entries(config.colors)) {
      if (key === "bright") continue;
      if (value != null) {
        (mappedColors as Record<string, unknown>)[key] = value;
      }
    }
    result.colors = mappedColors;
  }

  if (config.cursor?.style?.shape) {
    const shape = config.cursor.style.shape;
    if (shape === "bar") {
      result.cursorStyle = "bar";
    } else if (shape === "underline") {
      result.cursorStyle = "underline";
    } else {
      result.cursorStyle = "block";
    }
  }

  if (config.cursor?.style?.blinking) {
    result.cursorBlink = config.cursor.style.blinking === "always" || config.cursor.style.blinking === "off";
  }

  if (config.scrolling) {
    result.scrollback = config.scrolling.history || result.scrollback;
  }

  if (fontOverride) {
    result.fontFamily = fontOverride.family;
    result.fontSize = fontOverride.size;
  }

  return result;
}

export function useTerminalOptions(): UseTerminalOptionsResult {
  const {
    data: configResponse,
    isLoading,
    error: fetchError,
  } = useAlacrittyConfigRoute();

  const fontOverrideRef = useRef<{ family: string; size: number } | null>(null);
  const [fontFamily, setFontFamily] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState<number | null>(null);

  // Read font override from settings
  useEffect(() => {
    const readSettings = () => {
      const themeId = readPersistedTheme();
      const baseFamily =
        "'FiraCode Nerd Font', 'Fira Code', 'CaskaydiaCove Nerd Font', 'Cascadia Code', 'SF Mono', Menlo, Monaco, 'Courier New', monospace";
      const baseSize = 13;

      try {
        const savedFamily = localStorage.getItem(
          `terminal.font.family.${themeId}`,
        );
        const savedSize = localStorage.getItem(`terminal.font.size.${themeId}`);
        if (savedFamily || savedSize) {
          fontOverrideRef.current = {
            family: savedFamily || baseFamily,
            size: savedSize ? Number(savedSize) : baseSize,
          };
          setFontFamily(fontOverrideRef.current.family);
          setFontSize(fontOverrideRef.current.size);
        }
      } catch {
        // Settings read failure is non-fatal
      }
    };
    readSettings();
  }, []);

  // TODO: Subscribe to `terminal / config_changed` WebSocket envelopes
  // to invalidate the query when the config file changes (Plan 10, Task 9).
  // The envelope carries no payload, so just refetching is sufficient:
  // useConnectionStatusStore.getState().onConfigChanged?.(() => {})

  // Fetch error
  if (fetchError) {
    const message =
      fetchError instanceof Error
        ? fetchError.message
        : "Failed to load terminal configuration";
    return { options: undefined, isLoading: false, error: message };
  }

  // Loading
  if (isLoading || !configResponse) {
    return { options: undefined, isLoading: true, error: null };
  }

  // Merge
  const options = mergeTerminalOptions(configResponse, fontOverrideRef.current);

  return { options, isLoading: false, error: null };
}
