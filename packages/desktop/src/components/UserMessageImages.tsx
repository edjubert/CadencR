import { useCallback, useMemo, type ReactElement } from "react";
import { LightboxThumbnail } from "@/components/image-lightbox/LightboxThumbnail";
import { promptImageSrc } from "@/lib/prompt-image-cache";
import { openImageLightbox, type LightboxImage } from "@/stores/image-lightbox-store";
import type { ParsedUserMessageImage } from "@/types/agent-types";

interface UserMessageImagesProps {
  images: ParsedUserMessageImage[];
}

/**
 * Image attachments inside a sent user message.
 *
 * A single image gets a generous preview — it is usually a screenshot the whole
 * message is about — while several collapse to a square grid so a bubble with
 * six of them stays scannable.
 */
export function UserMessageImages({ images }: UserMessageImagesProps): ReactElement | null {
  const resolved = useMemo(
    () =>
      images.map((image, position): LightboxImage => {
        const alt = images.length > 1 ? `attached image ${position + 1}` : "attached image";
        return {
          // Refs are content fingerprints, so two copies of one screenshot in a
          // single message share a ref — the position keeps React keys unique
          // and lets the viewer tell the two slots apart.
          id: `${image.ref ?? "inline"}-${position}`,
          src: promptImageSrc(image),
          alt,
          mediaType: image.mediaType,
        };
      }),
    [images],
  );
  const open = useCallback((position: number) => openImageLightbox(resolved, position), [resolved]);

  if (resolved.length === 0) return null;
  const solo = resolved.length === 1;

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {resolved.map((image, position) => (
        <LightboxThumbnail
          key={image.id}
          src={image.src}
          alt={image.alt}
          onOpen={() => open(position)}
          className={solo ? "max-h-64" : "size-24"}
          imageClassName={solo ? "max-h-64 max-w-full object-contain" : "size-full object-cover"}
        />
      ))}
    </div>
  );
}
