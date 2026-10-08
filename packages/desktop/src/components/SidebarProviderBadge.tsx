import { memo, type CSSProperties, type ReactElement } from "react";
import { ShortcutTooltip } from "@/components/ShortcutTooltip";
import { BotIcon } from "lucide-react";
import { useProviderMetadata } from "@/lib/provider-icons";
import { thinkingEffortLabel, parseThinkingEffort } from "@/shared/thinking-effort";
import { useSidebarProviderLogos } from "@/components/SidebarPreferences";

interface SidebarProviderBadgeProps {
  providerId?: string | null;
  modelId?: string | null;
  thinkingEffort?: string | null;
}

/** Identity only: live status belongs to the leading status indicator. */
export const SidebarProviderBadge = memo(function SidebarProviderBadge({
  providerId,
  modelId,
  thinkingEffort,
}: SidebarProviderBadgeProps): ReactElement | null {
  const meta = useProviderMetadata(providerId, null, "mono");
  const showProviderLogos = useSidebarProviderLogos();
  if (!meta || !showProviderLogos) return null;

  const effort = parseThinkingEffort(thinkingEffort ?? undefined);
  const detail = [
    meta.label,
    modelId?.trim() || "Default",
    effort ? thinkingEffortLabel(effort) : "Default",
  ].join(" · ");

  return (
    <ShortcutTooltip label={detail} toRight className="sidebar-provider-logo shrink-0">
      <span
        role="img"
        aria-label={detail}
        data-provider-mark="mono"
        className="inline-flex size-3.5 items-center justify-center text-muted-foreground"
      >
        {meta.iconSrc ? (
          <span
            aria-hidden
            className="provider-mark-tint size-3.5"
            style={
              {
                "--provider-mark": `url("${meta.iconSrc}")`,
                "--provider-mark-size": `${(meta.monoIconScale ?? 1) * 100}%`,
              } as CSSProperties
            }
          />
        ) : (
          <BotIcon className="size-3.5" aria-hidden />
        )}
      </span>
    </ShortcutTooltip>
  );
});
