import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Top-level section block on the settings page. Pattern:
 *
 *   <h2>Title</h2>          <small>subtitle</small>
 *   [optional intro paragraph]
 *   <children />            (typically one or more <SettingsCard>)
 *
 * The `id` is set as both an HTML id and a `data-section` attribute so the
 * sidebar nav can scroll-track active sections.
 *
 * The `size` prop tunes the heading: `lg` for the main settings page, `sm`
 * for the project-settings modal where vertical density matters more.
 */
export function SettingsSection({
  id,
  title,
  subtitle,
  description,
  size = "lg",
  className,
  children,
}: {
  id?: string;
  title: ReactNode;
  /** Right-aligned eyebrow next to the title (e.g. "Theme · Loader style"). */
  subtitle?: ReactNode;
  /** Long-form intro paragraph below the title row. */
  description?: ReactNode;
  size?: "lg" | "sm";
  className?: string;
  children?: ReactNode;
}): React.JSX.Element {
  const headingClass = size === "lg" ? "text-base font-semibold" : "text-sm font-semibold";

  return (
    <section
      id={id}
      data-section={id ?? ""}
      className={cn(
        "space-y-3 scroll-mt-6 animate-in fade-in-0 slide-in-from-bottom-1 duration-300 ease-out",
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2 className={headingClass}>{title}</h2>
        {subtitle ? (
          <span className="text-xs text-muted-foreground truncate">{subtitle}</span>
        ) : null}
      </div>
      {description ? (
        <p className="-mt-1 text-xs text-muted-foreground leading-snug">{description}</p>
      ) : null}
      {/* One provider per section: hints inside open without the delay once one shows. */}
      <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
    </section>
  );
}
