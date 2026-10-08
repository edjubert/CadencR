import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactElement,
  type SetStateAction,
} from "react";
import { HandIcon, Loader2Icon, RotateCwIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  BrowserResponsiveColorScheme,
  BrowserResponsivePreset,
  BrowserResponsiveRequest,
  BrowserTabMetadata,
} from "@/lib/desktop-bridge";
import {
  isValidBrowserResponsiveState,
  toBrowserResponsiveRequest,
} from "@/shared/browser-responsive";

interface BrowserResponsiveToolbarProps {
  tab: BrowserTabMetadata;
  pending: boolean;
  displayScale: number | null;
  onApply: (request: BrowserResponsiveRequest) => Promise<void>;
  onOverlayOpenChange: (open: boolean) => void;
}

const PRESETS: Record<Exclude<BrowserResponsivePreset, "custom">, BrowserResponsiveRequest> = {
  desktop: {
    enabled: true,
    preset: "desktop",
    width: 1_280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
    touch: false,
    colorScheme: "system",
  },
  tablet: {
    enabled: true,
    preset: "tablet",
    width: 768,
    height: 1_024,
    deviceScaleFactor: 2,
    mobile: true,
    touch: true,
    colorScheme: "system",
  },
  mobile: {
    enabled: true,
    preset: "mobile",
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
    touch: true,
    colorScheme: "system",
  },
};

export const BrowserResponsiveToolbar = memo(function BrowserResponsiveToolbar({
  tab,
  pending,
  displayScale,
  onApply,
  onOverlayOpenChange,
}: BrowserResponsiveToolbarProps): ReactElement {
  const responsive = tab.responsive;
  const [draft, setDraft] = useResponsiveDraft(tab);
  const [presetOpen, setPresetOpen] = useState(false);
  const [colorSchemeOpen, setColorSchemeOpen] = useState(false);
  useEffect(() => {
    onOverlayOpenChange(presetOpen || colorSchemeOpen);
    return () => onOverlayOpenChange(false);
  }, [colorSchemeOpen, onOverlayOpenChange, presetOpen]);
  const validationError = useMemo(() => validateDraft(draft), [draft]);
  const updateNumber = useCallback(
    (field: "width" | "height" | "deviceScaleFactor", value: string): void => {
      setDraft((current) => ({ ...current, preset: "custom", [field]: Number(value) }));
    },
    [],
  );
  const choosePreset = useCallback((preset: BrowserResponsivePreset): void => {
    setDraft((current) =>
      preset === "custom"
        ? { ...current, preset }
        : { ...PRESETS[preset], colorScheme: current.colorScheme },
    );
  }, []);
  const rotate = useCallback((): void => {
    setDraft((current) => ({ ...current, width: current.height, height: current.width }));
  }, []);
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-border/70 pt-1.5">
      <BrowserResponsiveViewportControls
        draft={draft}
        pending={pending}
        invalid={validationError !== null}
        choosePreset={choosePreset}
        updateNumber={updateNumber}
        rotate={rotate}
        onPresetOpenChange={setPresetOpen}
      />
      <Button
        type="button"
        variant={draft.touch ? "secondary" : "ghost"}
        size="sm"
        disabled={pending}
        aria-label="Emulate touch input"
        aria-pressed={draft.touch}
        onClick={() => setDraft((current) => ({ ...current, touch: !current.touch }))}
      >
        <HandIcon className="size-3.5" /> Touch
      </Button>
      <ColorSchemeSelect
        value={draft.colorScheme}
        disabled={pending}
        onOpenChange={setColorSchemeOpen}
        onChange={(colorScheme) => setDraft((current) => ({ ...current, colorScheme }))}
      />
      <div className="flex min-w-48 flex-1 items-center gap-2 overflow-hidden">
        <ResponsiveModeSummary enabled={responsive.enabled} displayScale={displayScale} />
        <span className="min-w-0 flex-1 truncate text-[10px] text-destructive" role="status">
          {responsive.status === "error"
            ? "Chromium overrides could not be fully cleared. Apply or exit to retry."
            : validationError}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          size="sm"
          disabled={pending || validationError !== null}
          onClick={() => void onApply({ ...draft, enabled: true })}
        >
          {pending ? <Loader2Icon className="animate-spin" /> : null} Apply
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={pending}
          aria-label="Exit responsive mode"
          title="Exit responsive mode"
          onClick={() =>
            void onApply({ ...toBrowserResponsiveRequest(responsive), enabled: false })
          }
        >
          <XIcon className="size-4" />
        </Button>
      </div>
    </div>
  );
});

function useResponsiveDraft(
  tab: BrowserTabMetadata,
): [BrowserResponsiveRequest, Dispatch<SetStateAction<BrowserResponsiveRequest>>] {
  const responsive = tab.responsive;
  const [draft, setDraft] = useState<BrowserResponsiveRequest>(() =>
    toBrowserResponsiveRequest(responsive),
  );
  useEffect(() => {
    setDraft(toBrowserResponsiveRequest(responsive));
  }, [
    responsive.colorScheme,
    responsive.deviceScaleFactor,
    responsive.enabled,
    responsive.height,
    responsive.mobile,
    responsive.preset,
    responsive.status,
    responsive.touch,
    responsive.width,
    tab.id,
  ]);
  return [draft, setDraft];
}

function BrowserResponsiveViewportControls(props: {
  draft: BrowserResponsiveRequest;
  pending: boolean;
  invalid: boolean;
  choosePreset: (preset: BrowserResponsivePreset) => void;
  updateNumber: (field: "width" | "height" | "deviceScaleFactor", value: string) => void;
  rotate: () => void;
  onPresetOpenChange: (open: boolean) => void;
}): ReactElement {
  return (
    <>
      <Select
        value={props.draft.preset}
        disabled={props.pending}
        onOpenChange={props.onPresetOpenChange}
        onValueChange={(value) => props.choosePreset(value as BrowserResponsivePreset)}
      >
        <SelectTrigger size="sm" className="w-28" aria-label="Responsive device preset">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="desktop">Desktop</SelectItem>
          <SelectItem value="tablet">Tablet</SelectItem>
          <SelectItem value="mobile">Mobile</SelectItem>
          <SelectItem value="custom">Custom</SelectItem>
        </SelectContent>
      </Select>
      <DimensionInput
        label="Viewport width"
        shortLabel="W"
        value={props.draft.width}
        invalid={props.invalid}
        disabled={props.pending}
        onChange={(value) => props.updateNumber("width", value)}
      />
      <span aria-hidden="true" className="text-xs text-muted-foreground">
        ×
      </span>
      <DimensionInput
        label="Viewport height"
        shortLabel="H"
        value={props.draft.height}
        invalid={props.invalid}
        disabled={props.pending}
        onChange={(value) => props.updateNumber("height", value)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={props.pending}
        onClick={props.rotate}
        aria-label="Rotate responsive viewport"
        title="Rotate viewport"
      >
        <RotateCwIcon className="size-4" />
      </Button>
      <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
        DPR
        <Input
          type="number"
          min={1}
          max={3}
          step={0.25}
          value={props.draft.deviceScaleFactor}
          disabled={props.pending}
          aria-label="Device pixel ratio"
          aria-invalid={props.invalid}
          className="h-8 w-16 px-2 font-mono text-xs"
          onChange={(event) => props.updateNumber("deviceScaleFactor", event.target.value)}
        />
      </label>
    </>
  );
}

function DimensionInput(props: {
  label: string;
  shortLabel: string;
  value: number;
  invalid: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
}): ReactElement {
  return (
    <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
      {props.shortLabel}
      <Input
        type="number"
        min={240}
        max={2_560}
        step={1}
        value={props.value}
        disabled={props.disabled}
        aria-label={props.label}
        aria-invalid={props.invalid}
        className="h-8 w-20 px-2 font-mono text-xs"
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  );
}

function ColorSchemeSelect(props: {
  value: BrowserResponsiveColorScheme;
  disabled: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (value: BrowserResponsiveColorScheme) => void;
}): ReactElement {
  return (
    <Select
      value={props.value}
      disabled={props.disabled}
      onOpenChange={props.onOpenChange}
      onValueChange={(value) => props.onChange(value as BrowserResponsiveColorScheme)}
    >
      <SelectTrigger size="sm" className="w-24" aria-label="Emulated color scheme">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="system">System</SelectItem>
        <SelectItem value="light">Light</SelectItem>
        <SelectItem value="dark">Dark</SelectItem>
      </SelectContent>
    </Select>
  );
}

function ResponsiveModeSummary({
  enabled,
  displayScale,
}: {
  enabled: boolean;
  displayScale: number | null;
}): ReactElement {
  const fit = enabled
    ? displayScale === null
      ? "Fit …"
      : `Fit ${Math.round(displayScale * 100)}%`
    : "Fit off";
  return (
    <span
      className="min-w-0 truncate whitespace-nowrap text-[10px] text-muted-foreground"
      title="Chromium viewport emulation; this does not emulate Safari or change the mobile user agent."
    >
      {fit} · Chromium · mobile UA unchanged
    </span>
  );
}

function validateDraft(draft: BrowserResponsiveRequest): string | null {
  if (isValidBrowserResponsiveState(draft)) return null;
  return "Use 240–2560 px, DPR 1–3, and at most 4 MP.";
}
