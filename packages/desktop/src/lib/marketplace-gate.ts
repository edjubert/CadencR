/** Unreleased distribution UI: development/QA must opt in explicitly at build time.
 * Production builds stay off even if the environment variable is supplied.
 * Deliberately has no URL, settings, or local-storage override.
 */
export function marketplaceBuildEnabled(development: boolean, optIn: unknown): boolean {
  return development && optIn === "true";
}

export const MARKETPLACE_ENABLED = marketplaceBuildEnabled(
  import.meta.env.DEV,
  import.meta.env.VITE_INTERNAL_MARKETPLACE,
);
