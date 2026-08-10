import { Badge } from "@/components/ui/badge";
import type { AppEnvironment, AppEnvironmentKind } from "@/lib/app-environment";
import { cn } from "@/lib/utils";

interface AppEnvironmentBadgeProps {
  className?: string;
  environment: AppEnvironment;
}

const badgeBaseClass =
  "h-auto rounded px-1 py-px text-[9px] font-semibold uppercase leading-none tracking-wider";

// One tone per kind, each visually distinct at 9px. Version branches borrow the
// theme-owned `--acc-purple` rather than a fixed hex so it stays legible on
// light and dark grounds alike.
const badgeToneByKind: Record<AppEnvironmentKind, string> = {
  beta: "border-primary/25 bg-primary/15 text-primary",
  dev: "border-orange-500/25 bg-orange-500/20 text-orange-400",
  version:
    "border-[color-mix(in_oklab,var(--acc-purple)_30%,transparent)] " +
    "bg-[color-mix(in_oklab,var(--acc-purple)_15%,transparent)] text-[var(--acc-purple)]",
};

export function AppEnvironmentBadge({
  className,
  environment,
}: AppEnvironmentBadgeProps): React.JSX.Element {
  const label = environment.kind === "version" ? environment.version : environment.kind;

  return (
    <Badge
      className={cn(badgeBaseClass, badgeToneByKind[environment.kind], className)}
      variant="outline"
    >
      {label}
    </Badge>
  );
}
