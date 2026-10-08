import type { ReactElement } from "react";
import { ExternalLinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function BrowserExternalButton({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      disabled={disabled}
      onClick={onClick}
      aria-label="Open in default browser"
      title="Open in default browser (cookies and sign-in state are not transferred)"
    >
      <ExternalLinkIcon className="size-4" />
    </Button>
  );
}
