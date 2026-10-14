import { memo, useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { ExternalLinkIcon, Loader2Icon, ShieldAlertIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { desktopBridge, type BrowserPopupRequest } from "@/lib/desktop-bridge";
import { showBrowserError } from "./browser-errors";

type PendingAction = "allow" | "external" | "dismiss" | null;

interface PopupNoticeActionsProps {
  request: BrowserPopupRequest;
  refresh: () => Promise<void>;
}

function PopupNoticeActions({ request, refresh }: PopupNoticeActionsProps): ReactElement {
  const [pending, setPending] = useState<PendingAction>(null);
  const operationPending = useRef(false);
  const allowed = request.status === "allowed-once";
  const run = async (action: Exclude<PendingAction, null>): Promise<void> => {
    if (operationPending.current) return;
    operationPending.current = true;
    setPending(action);
    try {
      if (action === "allow") await desktopBridge.allowBrowserPopupOnce(request.id);
      else if (action === "external") await desktopBridge.openBrowserPopupExternally(request.id);
      else await desktopBridge.dismissBrowserPopup(request.id);
      await refresh();
    } catch (error) {
      showBrowserError(
        error,
        action === "allow"
          ? "Could not allow popup"
          : action === "external"
            ? "Could not open popup externally"
            : "Could not dismiss popup",
      );
    } finally {
      operationPending.current = false;
      setPending(null);
    }
  };
  return (
    <>
      <Button
        type="button"
        size="xs"
        variant="outline"
        disabled={pending !== null || allowed}
        aria-busy={pending === "allow"}
        onClick={() => void run("allow")}
      >
        {pending === "allow" ? <Loader2Icon className="animate-spin" /> : null}
        {allowed ? "Allowed once" : "Allow once"}
      </Button>
      {request.externalAvailable ? (
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={pending !== null}
          aria-busy={pending === "external"}
          onClick={() => void run("external")}
        >
          {pending === "external" ? <Loader2Icon className="animate-spin" /> : <ExternalLinkIcon />}
          Open address externally
        </Button>
      ) : null}
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        disabled={pending !== null}
        aria-label="Dismiss blocked popup"
        onClick={() => void run("dismiss")}
      >
        {pending === "dismiss" ? <Loader2Icon className="animate-spin" /> : <XIcon />}
      </Button>
    </>
  );
}

export const BrowserPopupNotice = memo(function BrowserPopupNotice({
  scopeId,
  activeTabId,
}: {
  scopeId: number;
  activeTabId: string | null;
}): ReactElement | null {
  const [requests, setRequests] = useState<BrowserPopupRequest[]>([]);
  const revision = useRef(0);
  const mounted = useRef(true);
  const refresh = useCallback(async (): Promise<void> => {
    const currentRevision = ++revision.current;
    try {
      const next = await desktopBridge.listBlockedBrowserPopups(scopeId);
      if (mounted.current && currentRevision === revision.current) setRequests(next);
    } catch (error) {
      if (mounted.current && currentRevision === revision.current) {
        showBrowserError(error, "Could not read blocked popups");
      }
    }
  }, [scopeId]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const off = desktopBridge.onBrowserPopupRequestsChanged((event) => {
      if (event.scopeId === scopeId) void refresh();
    });
    return () => {
      mounted.current = false;
      revision.current += 1;
      off();
    };
  }, [refresh, scopeId]);

  const request = requests.find((item) => item.tabId === activeTabId);
  if (!request) return null;
  const allowed = request.status === "allowed-once";
  const count = requests.length;

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-2 border-b border-[color-mix(in_oklab,var(--acc-orange)_35%,transparent)] bg-[color-mix(in_oklab,var(--acc-orange)_8%,var(--card))] px-3 py-2 text-xs text-foreground"
    >
      <ShieldAlertIcon className="size-4 shrink-0 text-[var(--acc-orange)]" />
      <div className="min-w-48 flex-1">
        <p className="font-medium">
          {allowed ? "Popup allowed once" : "Popup blocked"} from {request.origin}
          {count > 1 ? ` (+${count - 1} more)` : ""}
        </p>
        <p className="text-muted-foreground">
          {allowed
            ? "Retry the sign-in action in the page within 30 seconds."
            : "Allow the next popup once, then retry the sign-in action."}
        </p>
        {request.externalAvailable ? (
          <p className="text-muted-foreground">
            External opening transfers neither embedded cookies
            {request.hasPostData ? " nor submitted form data" : " nor sign-in state"}.
          </p>
        ) : null}
      </div>
      <PopupNoticeActions request={request} refresh={refresh} />
    </div>
  );
});
