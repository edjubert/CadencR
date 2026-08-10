import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Dialog, DialogOverlay, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import { useSuppressBrowserView } from "@/lib/browser-suppression";
import { useImageLightboxStore, type LightboxImage } from "@/stores/image-lightbox-store";
import { LightboxCanvas } from "./image-lightbox/LightboxCanvas";
import { LightboxRail } from "./image-lightbox/LightboxRail";
import { LightboxToolbar } from "./image-lightbox/LightboxToolbar";
import {
  copyLightboxImage,
  downloadLightboxImage,
  lightboxFileName,
} from "./image-lightbox/lightbox-actions";
import { useLightboxZoom } from "./image-lightbox/useLightboxZoom";

/**
 * The app's single image viewer, mounted once beside the other root overlays.
 *
 * Built on the shared `Dialog` primitives so it inherits the focus trap, the
 * Escape handling, and — through `data-slot="dialog-overlay"` — the per-theme
 * backdrop treatment: a flat scrim on the solid themes, a blur on the frost
 * ones (`theme-frost.css`).
 *
 * It composes `DialogPortal`/`DialogOverlay` by hand rather than using
 * `DialogContent`, which carries `data-slot="dialog-content"` — the frost themes
 * give that slot its own background and `backdrop-filter`, and a full-bleed
 * viewer must not paint a panel or become a backdrop root for the image.
 */
export function ImageLightboxHost(): ReactElement {
  const open = useImageLightboxStore((s) => s.open);
  const close = useImageLightboxStore((s) => s.close);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      {open && <LightboxContent onClose={close} />}
    </Dialog>
  );
}

interface Dimensions {
  width: number;
  height: number;
}

function LightboxContent({ onClose }: { onClose: () => void }): ReactElement | null {
  // A native browser view sits above the React DOM, so it has to be hidden for
  // exactly as long as this overlay is up — same contract as `DialogContent`.
  useSuppressBrowserView();
  const images = useImageLightboxStore((s) => s.images);
  const index = useImageLightboxStore((s) => s.index);
  const setIndex = useImageLightboxStore((s) => s.setIndex);
  const step = useImageLightboxStore((s) => s.step);
  const [dimensions, setDimensions] = useState<Dimensions | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);

  const image: LightboxImage | undefined = images[index];
  const zoom = useLightboxZoom(image?.id ?? index, surfaceRef);

  // The caption would otherwise keep the previous image's size until the new
  // one decodes — and forever if it fails.
  useEffect(() => setDimensions(null), [image?.id]);

  const handleLoad = useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
    setDimensions({
      width: event.currentTarget.naturalWidth,
      height: event.currentTarget.naturalHeight,
    });
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      // Modal-local keys: deliberately not in the shortcut registry, which is
      // for app-wide customizable bindings.
      switch (event.key) {
        case "ArrowLeft":
          step(-1);
          break;
        case "ArrowRight":
          step(1);
          break;
        case "+":
        case "=":
          zoom.zoomIn();
          break;
        case "-":
          zoom.zoomOut();
          break;
        case "0":
          zoom.reset();
          break;
        default:
          return;
      }
      event.preventDefault();
    },
    [step, zoom],
  );

  const caption = useMemo(
    () =>
      [
        images.length > 1 ? `${index + 1} of ${images.length}` : null,
        dimensions ? `${dimensions.width} × ${dimensions.height}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    [dimensions, images.length, index],
  );

  if (!image) return null;
  const fileName = lightboxFileName(image.fileName, image.mediaType);

  return (
    <DialogPortal>
      <DialogOverlay className="bg-black/80" />
      <DialogPrimitive.Content
        aria-describedby={undefined}
        onKeyDown={handleKeyDown}
        className="data-[state=open]:animate-in data-[state=open]:fade-in-0 fixed inset-0 z-50 flex flex-col outline-none duration-150"
      >
        <DialogTitle className="sr-only">{image.alt}</DialogTitle>
        <header className="flex shrink-0 items-start justify-between gap-4 p-4">
          <div className="min-w-0 rounded-lg border border-white/10 bg-black/45 px-3 py-2 backdrop-blur-md">
            <p className="truncate text-sm font-medium text-white/90">{fileName}</p>
            {caption && <p className="font-mono text-[11px] text-white/55">{caption}</p>}
          </div>
          <LightboxToolbar
            scale={zoom.scale}
            onZoomIn={zoom.zoomIn}
            onZoomOut={zoom.zoomOut}
            onReset={zoom.reset}
            onCopy={() => image.src && void copyLightboxImage(image.src)}
            onDownload={() => image.src && downloadLightboxImage(image.src, fileName)}
            onClose={onClose}
            actionsDisabled={!image.src}
          />
        </header>
        <LightboxCanvas
          image={image}
          zoom={zoom}
          surfaceRef={surfaceRef}
          onLoad={handleLoad}
          onDismiss={onClose}
        />
        <LightboxRail images={images} index={index} onSelect={setIndex} />
        {images.length > 1 && (
          <>
            <StepButton side="left" onClick={() => step(-1)} />
            <StepButton side="right" onClick={() => step(1)} />
          </>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function StepButton({
  side,
  onClick,
}: {
  side: "left" | "right";
  onClick: () => void;
}): ReactElement {
  const Icon = side === "left" ? ChevronLeftIcon : ChevronRightIcon;
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      aria-label={side === "left" ? "Previous image (←)" : "Next image (→)"}
      className={`absolute top-1/2 -translate-y-1/2 rounded-full border border-white/10 bg-black/45 text-white/75 backdrop-blur-md hover:bg-black/70 hover:text-white ${
        side === "left" ? "left-4" : "right-4"
      }`}
    >
      <Icon className="size-5" />
    </Button>
  );
}
