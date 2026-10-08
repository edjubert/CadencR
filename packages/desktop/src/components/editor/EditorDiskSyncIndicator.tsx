import { memo, useState } from "react";
import { AlertCircleIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export interface EditorDiskSyncState {
  diskChanged: boolean;
  isSaving: boolean;
  errorMessage: string | null;
  reloadFromDisk: () => Promise<void>;
  overwriteDisk: () => Promise<void>;
}

export const EditorDiskSyncIndicator = memo(function EditorDiskSyncIndicator({
  sync,
}: {
  sync: EditorDiskSyncState;
}) {
  const [open, setOpen] = useState(false);
  if (!sync.diskChanged && !open) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 gap-1 px-1 text-xs text-[var(--acc-orange)]"
          title="File changed on disk. Your unsaved buffer is preserved; autosave is paused."
        >
          <AlertCircleIcon className="size-3" /> Disk changed
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>File changed on disk</DialogTitle>
          <DialogDescription>
            Your buffer has been kept. Autosave is paused until you resolve the disk change. Reload
            discards your unsaved edits and reads the latest file from disk. Overwrite saves your
            buffer instead, replacing the disk version.
          </DialogDescription>
        </DialogHeader>
        {sync.errorMessage && (
          <p role="alert" className="text-sm text-destructive">
            {sync.errorMessage}
          </p>
        )}
        {sync.isSaving && (
          <p role="status" className="flex items-center gap-1 text-sm">
            <Loader2Icon className="size-3 animate-spin" /> Synchronizing…
          </p>
        )}
        {!sync.diskChanged && !sync.isSaving && (
          <p role="status" className="text-sm">
            Disk change resolved.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Keep editing
          </Button>
          <Button
            variant="outline"
            disabled={sync.isSaving || !sync.diskChanged}
            onClick={() => void sync.overwriteDisk()}
          >
            Overwrite disk
          </Button>
          <Button
            disabled={sync.isSaving || !sync.diskChanged}
            onClick={() => void sync.reloadFromDisk()}
          >
            Discard edits and reload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
