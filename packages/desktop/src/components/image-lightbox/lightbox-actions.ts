import { toast } from "sonner";
import { apiErrorMessage } from "@/lib/api-errors";
import { extensionForMime } from "@/lib/prompt-attachments";

/** Extension guessed from the MIME type, for the download filename. */
function extensionFor(mediaType: string | undefined): string {
  return (mediaType && extensionForMime(mediaType)) || "png";
}

export function lightboxFileName(fileName: string | undefined, mediaType: string | undefined) {
  if (fileName) return fileName;
  return `image.${extensionFor(mediaType)}`;
}

/**
 * Re-encode to PNG through a canvas. The async clipboard only accepts a short
 * list of types across browsers — PNG is the one that is always allowed — so a
 * JPEG or WebP has to be converted before it can be written.
 */
async function toPngBlob(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context unavailable");
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!png) throw new Error("Could not encode the image as PNG");
  return png;
}

export async function copyLightboxImage(src: string): Promise<void> {
  try {
    const blob = await (await fetch(src)).blob();
    const png = blob.type === "image/png" ? blob : await toPngBlob(blob);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    toast.success("Image copied to the clipboard");
  } catch (error) {
    toast.error("Couldn't copy the image", {
      description: apiErrorMessage(error, "The clipboard rejected the image"),
    });
  }
}

export function downloadLightboxImage(src: string, fileName: string): void {
  try {
    const link = document.createElement("a");
    link.href = src;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch (error) {
    toast.error("Couldn't save the image", {
      description: apiErrorMessage(error, "The download could not be started"),
    });
  }
}
