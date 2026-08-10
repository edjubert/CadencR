import { FileText, X } from "lucide-react";
import { useCallback, useMemo, type ReactElement } from "react";
import { LightboxThumbnail } from "@/components/image-lightbox/LightboxThumbnail";
import { cn } from "@/lib/utils";
import { ImageAttachment } from "@/hooks/useImageAttachments";
import { openImageLightbox, type LightboxImage } from "@/stores/image-lightbox-store";

interface ImageAttachmentPreviewProps {
  attachments: ImageAttachment[];
  onRemove: (id: string) => void;
  className?: string;
}

export function ImageAttachmentPreview({
  attachments,
  onRemove,
  className,
}: ImageAttachmentPreviewProps): ReactElement | null {
  // Only images are viewable, so the lightbox list is a filtered projection of
  // the attachment row — the index a thumbnail opens is its position here, not
  // its position among all attachments.
  const viewable = useMemo(
    () =>
      attachments
        .filter((attachment) => attachment.kind === "image" && attachment.previewUrl)
        .map(
          (attachment): LightboxImage => ({
            id: attachment.id,
            src: attachment.previewUrl,
            alt: attachment.fileName,
            fileName: attachment.fileName,
            mediaType: attachment.mimeType,
          }),
        ),
    [attachments],
  );
  const openAt = useCallback(
    (id: string) => {
      const index = viewable.findIndex((image) => image.id === id);
      if (index >= 0) openImageLightbox(viewable, index);
    },
    [viewable],
  );

  if (attachments.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap gap-2 p-2", className)}>
      {attachments.map((attachment) => (
        <div key={attachment.id} className="group relative">
          {attachment.kind === "image" && attachment.previewUrl ? (
            <LightboxThumbnail
              src={attachment.previewUrl}
              alt={attachment.fileName}
              onOpen={() => openAt(attachment.id)}
              className="size-14"
              imageClassName="size-full object-cover"
            />
          ) : (
            <div
              title={attachment.fileName}
              className="flex h-14 max-w-40 items-center gap-2 rounded-md border border-border bg-muted/50 px-2 text-xs text-foreground"
            >
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{attachment.fileName}</span>
            </div>
          )}
          <button
            type="button"
            onClick={() => onRemove(attachment.id)}
            className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 transition-opacity group-hover:opacity-100"
            aria-label={`Remove ${attachment.fileName}`}
          >
            <X className="size-2.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
