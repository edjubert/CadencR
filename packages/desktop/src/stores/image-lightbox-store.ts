import { create } from "zustand";

/**
 * The single open image viewer, owned globally rather than per call site.
 *
 * Stream rows are virtualized, so an overlay portalled from inside a message
 * bubble dies the moment Virtuoso recycles that row. Hoisting the state here
 * lets `ImageLightboxHost` mount once next to the other root overlays, and lets
 * openers fire from anywhere — including outside React — through `getState()`.
 * Only the host subscribes, so opening the viewer re-renders nothing else.
 */
export interface LightboxImage {
  /** Stable identity for the React key and the thumbnail rail. */
  id: string;
  /** Blob or data URL. `null` when the payload is no longer resolvable. */
  src: string | null;
  alt: string;
  fileName?: string;
  mediaType?: string;
}

interface ImageLightboxState {
  open: boolean;
  images: LightboxImage[];
  index: number;
  openLightbox: (images: LightboxImage[], index?: number) => void;
  close: () => void;
  setIndex: (index: number) => void;
  /** Move by `delta`, wrapping around the ends. */
  step: (delta: number) => void;
}

export const useImageLightboxStore = create<ImageLightboxState>((set, get) => ({
  open: false,
  images: [],
  index: 0,
  openLightbox: (images, index = 0) => {
    if (images.length === 0) return;
    set({ open: true, images, index: Math.min(Math.max(index, 0), images.length - 1) });
  },
  // The host unmounts its content on close, so the stale list is never read;
  // the next open replaces it wholesale.
  close: () => set({ open: false }),
  setIndex: (index) => set({ index }),
  step: (delta) => {
    const { images, index } = get();
    if (images.length < 2) return;
    set({ index: (index + delta + images.length) % images.length });
  },
}));

/** Open the viewer from anywhere without subscribing to it. */
export function openImageLightbox(images: LightboxImage[], index = 0): void {
  useImageLightboxStore.getState().openLightbox(images, index);
}
