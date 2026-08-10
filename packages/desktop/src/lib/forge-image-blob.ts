import { customInstance } from "@/api/client";

/**
 * Fetch an image a pull request points at, through the service.
 *
 * The renderer CSP is `img-src 'self' data: blob:`, so an `<img>` aimed at a
 * forge asset host (`avatars.githubusercontent.com`, an attachment CDN, a
 * badge) is blocked before the request leaves — and a private repository's
 * attachments need the forge token, which an `<img>` cannot carry either. The
 * service fetches the bytes with the right credentials and this returns them as
 * a Blob; callers turn it into a `blob:` object URL, which the CSP allows.
 *
 * `src` is passed exactly as the pull request body wrote it — the service
 * resolves relative and protocol-relative forms against the repository.
 */
export function forgeImageBlob(
  featureId: number,
  src: string,
  kind: ForgeImageKind,
  signal?: AbortSignal,
): Promise<Blob> {
  return customInstance<Blob>({
    url: "/api/git/forge/image",
    method: "GET",
    params: { feature_id: featureId, url: src, kind },
    responseType: "blob",
    signal,
  });
}

/**
 * React Query key for a forge image, so the same avatar recurring on forty
 * comments is fetched once.
 */
export function forgeImageBlobQueryKey(
  featureId: number,
  src: string,
  kind: ForgeImageKind,
): readonly unknown[] {
  return ["/api/git/forge/image", { feature_id: featureId, url: src, kind }];
}

export type ForgeImageKind = "avatar" | "content";
