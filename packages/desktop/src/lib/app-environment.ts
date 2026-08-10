// Build-time constant injected by electron-vite via `define` in
// `electron.vite.config.ts`. Holds the git branch the bundle was built from,
// or "" when git could not be reached.
declare const __APP_BUILD_BRANCH__: string;

export type AppEnvironment =
  | { kind: "beta" }
  | { kind: "dev" }
  | { kind: "version"; version: string };

export type AppEnvironmentKind = AppEnvironment["kind"];

const VERSION_BRANCH_PATTERN = /^v[0-9]+\.[0-9]+\.[0-9]+$/;

/**
 * Which environment badge the sidebar shows:
 *
 * - `pnpm dev` → DEV, whatever the branch is.
 * - `pnpm build:local` on `vX.Y.Z` → that version (integration build, not released).
 * - anything else, including packaged releases → BETA.
 *
 * Releases are built from a detached tag checkout, so they report no branch and
 * fall through to BETA.
 */
export function resolveAppEnvironment(source: {
  branch: string;
  isDevServer: boolean;
}): AppEnvironment {
  if (source.isDevServer) return { kind: "dev" };

  const branch = source.branch.trim();
  return VERSION_BRANCH_PATTERN.test(branch)
    ? { kind: "version", version: branch }
    : { kind: "beta" };
}

export const APP_ENVIRONMENT: AppEnvironment = resolveAppEnvironment({
  branch: __APP_BUILD_BRANCH__,
  isDevServer: import.meta.env.DEV,
});
