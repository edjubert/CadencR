import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { CameraIcon, ClipboardIcon, Loader2Icon, MapPinIcon, MicIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  desktopBridge,
  type BrowserSitePermission,
  type BrowserSitePermissionRequest,
} from "@/lib/desktop-bridge";
import { showBrowserError } from "./browser-errors";

const DETAILS: Record<BrowserSitePermission, { label: string; Icon: typeof CameraIcon }> = {
  camera: { label: "Use your camera", Icon: CameraIcon },
  microphone: { label: "Use your microphone", Icon: MicIcon },
  location: { label: "Know your location", Icon: MapPinIcon },
  clipboard: { label: "Read your clipboard", Icon: ClipboardIcon },
};

interface BrowserPermissionPromptProps {
  scopeId: number;
  onOpenChange: (open: boolean) => void;
}

export function BrowserPermissionPrompt({
  scopeId,
  onOpenChange,
}: BrowserPermissionPromptProps): ReactElement | null {
  const [requests, setRequests] = useState<BrowserSitePermissionRequest[]>([]);
  const [responding, setResponding] = useState(false);
  const request = requests[0] ?? null;
  const requestsRef = useRef(requests);
  requestsRef.current = requests;

  useEffect(() => {
    const offRequest = desktopBridge.onBrowserPermissionRequest((next) => {
      if (next.scopeId !== scopeId) return;
      setRequests((current) =>
        current.some((item) => item.requestId === next.requestId) ? current : [...current, next],
      );
    });
    const offCancelled = desktopBridge.onBrowserPermissionRequestCancelled(({ requestId }) => {
      setRequests((current) => current.filter((item) => item.requestId !== requestId));
    });
    return () => {
      offRequest();
      offCancelled();
      for (const pending of requestsRef.current) {
        void desktopBridge
          .resolveBrowserPermissionRequest(pending.requestId, false)
          .catch((error: unknown) =>
            showBrowserError(error, "Could not cancel website permission request"),
          );
      }
    };
  }, [scopeId]);

  useEffect(() => {
    onOpenChange(request !== null);
    return () => onOpenChange(false);
  }, [onOpenChange, request]);

  const respond = useCallback(
    async (allowed: boolean): Promise<void> => {
      if (!request) return;
      setResponding(true);
      try {
        await desktopBridge.resolveBrowserPermissionRequest(request.requestId, allowed);
      } catch (error) {
        showBrowserError(error, "Could not answer website permission request");
      } finally {
        setRequests((current) => current.filter((item) => item.requestId !== request.requestId));
        setResponding(false);
      }
    },
    [request],
  );

  if (!request) return null;
  return (
    <Dialog open>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Allow website permission?</DialogTitle>
          <DialogDescription>
            <span className="font-mono text-foreground">{request.origin}</span> is requesting access
            in this tab. This is a website permission, not agent sharing.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2 rounded-md border bg-muted/30 p-3">
          {request.permissions.map((permission) => {
            const { label, Icon } = DETAILS[permission];
            return (
              <li key={permission} className="flex items-center gap-2 text-sm">
                <Icon className="size-4 text-muted-foreground" /> {label}
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-muted-foreground">
          Embedded cross-origin frames are blocked and cannot trigger this prompt.
        </p>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={responding}
            onClick={() => void respond(false)}
          >
            Block
          </Button>
          <Button type="button" disabled={responding} onClick={() => void respond(true)}>
            {responding ? <Loader2Icon className="size-4 animate-spin" /> : null}
            Allow
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
