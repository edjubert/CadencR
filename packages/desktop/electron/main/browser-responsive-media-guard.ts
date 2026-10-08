import type { WebContents } from "electron";

import type { BrowserResponsiveRequest } from "./browser-types";
import type { ManagedTab } from "./browser-tab-events";

const MEDIA_GUARD_WORLD_ID = 1_001;
const MEDIA_GUARD_SLOT = "__cadencrResponsiveMediaGuard";

type MediaGuardKind = "mismatch" | "stale";

export type BrowserResponsiveMediaGuardResult =
  | { token: number; kind: MediaGuardKind }
  | { token: number; kind: "error"; error: Error };

export interface BrowserResponsiveMediaGuard {
  token: number;
  result: Promise<BrowserResponsiveMediaGuardResult>;
  cancel(): Promise<void>;
}

interface MediaGuardState {
  generation: number;
  pending: boolean;
  guard: BrowserResponsiveMediaGuard | null;
}

interface MediaGuardHost {
  refresh(tab: ManagedTab): void;
  reportError(error: unknown, scopeId: number | null): void;
}

/** Keeps one bounded, one-shot appearance guard outside the responsive mutation queue. */
export class BrowserResponsiveMediaGuardCoordinator {
  private readonly states = new WeakMap<ManagedTab, MediaGuardState>();

  constructor(private readonly host: MediaGuardHost) {}

  loaded(tab: ManagedTab, afterRefresh: Promise<void>): void {
    const state = this.state(tab);
    this.cancelGuard(state);
    state.pending = true;
    const generation = state.generation;
    void afterRefresh.then(
      () => {
        if (state.generation === generation && state.pending) this.arm(tab, state);
      },
      (error: unknown) => {
        if (state.generation !== generation || !state.pending) return;
        state.pending = false;
        this.host.reportError(error, tab.metadata.scopeId);
      },
    );
  }

  reconfigure(tab: ManagedTab, request: BrowserResponsiveRequest): void {
    const state = this.state(tab);
    const pending = state.pending && hasForcedColorScheme(request);
    this.cancelGuard(state);
    state.pending = pending;
  }

  applied(tab: ManagedTab): void {
    const state = this.state(tab);
    if (state.pending) this.arm(tab, state);
  }

  cancel(tab: ManagedTab): void {
    const state = this.state(tab);
    this.cancelGuard(state);
    state.pending = false;
  }

  private arm(tab: ManagedTab, state: MediaGuardState): void {
    const responsive = tab.metadata.responsive;
    if (
      !state.pending ||
      !hasForcedColorScheme(responsive) ||
      responsive.colorScheme === "system" ||
      responsive.status !== "ready" ||
      tab.webContents.isDestroyed()
    ) {
      this.cancel(tab);
      return;
    }
    this.cancelGuard(state);
    state.pending = true;
    const guard = createBrowserResponsiveMediaGuard(
      tab.webContents,
      responsive.colorScheme,
      state.generation,
    );
    state.guard = guard;
    void guard.result.then((result) => this.finish(tab, state, guard, result));
  }

  private finish(
    tab: ManagedTab,
    state: MediaGuardState,
    guard: BrowserResponsiveMediaGuard,
    result: BrowserResponsiveMediaGuardResult,
  ): void {
    if (state.guard !== guard || result.token !== state.generation) return;
    state.guard = null;
    state.pending = false;
    if (result.kind === "stale" || tab.webContents.isDestroyed()) return;
    if (result.kind === "error") {
      this.host.reportError(result.error, tab.metadata.scopeId);
      return;
    }
    if (hasForcedColorScheme(tab.metadata.responsive)) this.host.refresh(tab);
  }

  private cancelGuard(state: MediaGuardState): void {
    state.generation += 1;
    const guard = state.guard;
    state.guard = null;
    // Cancellation makes this lifetime stale; remote context teardown errors
    // cannot affect the replacement guard and are intentionally ignored.
    if (guard) void guard.cancel().catch(() => undefined);
  }

  private state(tab: ManagedTab): MediaGuardState {
    const existing = this.states.get(tab);
    if (existing) return existing;
    const created = { generation: 0, pending: false, guard: null };
    this.states.set(tab, created);
    return created;
  }
}

export function createBrowserResponsiveMediaGuard(
  webContents: WebContents,
  colorScheme: "light" | "dark",
  token: number,
): BrowserResponsiveMediaGuard {
  let cancelLocally!: () => void;
  let cancelled = false;
  const cancellation = new Promise<BrowserResponsiveMediaGuardResult>((resolve) => {
    cancelLocally = () => resolve({ token, kind: "stale" });
  });
  const observation = observeMediaMismatch(webContents, colorScheme, token, () => cancelled);
  return {
    token,
    result: Promise.race([observation, cancellation]),
    cancel: async () => {
      if (cancelled) return;
      cancelled = true;
      cancelLocally();
      if (webContents.isDestroyed()) return;
      const result = await runIsolated(webContents, cancelScript(token));
      parseMediaGuardResult(result, token, ["stale"]);
    },
  };
}

async function observeMediaMismatch(
  webContents: WebContents,
  colorScheme: "light" | "dark",
  token: number,
  isCancelled: () => boolean,
): Promise<BrowserResponsiveMediaGuardResult> {
  try {
    const armed = await runIsolated(webContents, armScript(colorScheme, token));
    parseMediaGuardResult(armed, token, ["stale"]);
    if (isCancelled()) return { token, kind: "stale" };
    const outcome = await runIsolated(webContents, waitScript(token));
    return parseMediaGuardResult(outcome, token, ["mismatch", "stale"]);
  } catch (error) {
    if (isCancelled() || webContents.isDestroyed() || isDestroyedContextError(error)) {
      return { token, kind: "stale" };
    }
    return { token, kind: "error", error: toError(error) };
  }
}

function runIsolated(webContents: WebContents, code: string): Promise<unknown> {
  return webContents.executeJavaScriptInIsolatedWorld(MEDIA_GUARD_WORLD_ID, [{ code }]);
}

function armScript(colorScheme: "light" | "dark", token: number): string {
  const expectedDark = colorScheme === "dark";
  return `(() => {
    const slot = ${JSON.stringify(MEDIA_GUARD_SLOT)};
    globalThis[slot]?.cancel?.();
    let resolveOutcome;
    const outcome = new Promise((resolve) => { resolveOutcome = resolve; });
    const query = globalThis.matchMedia("(prefers-color-scheme: dark)");
    const guard = { token: ${token}, outcome, cancel: () => finish("stale") };
    let settled = false;
    const finish = (kind) => {
      if (settled) return;
      settled = true;
      query.removeEventListener("change", check);
      globalThis.removeEventListener("pagehide", guard.cancel);
      resolveOutcome({ version: 1, token: ${token}, kind });
    };
    const check = () => { if (query.matches !== ${expectedDark}) finish("mismatch"); };
    globalThis[slot] = guard;
    query.addEventListener("change", check);
    globalThis.addEventListener("pagehide", guard.cancel, { once: true });
    check();
    return { version: 1, token: ${token}, kind: "stale" };
  })()`;
}

function waitScript(token: number): string {
  return `(() => {
    const guard = globalThis[${JSON.stringify(MEDIA_GUARD_SLOT)}];
    if (guard?.token !== ${token}) return { version: 1, token: ${token}, kind: "stale" };
    return guard.outcome.then((result) => {
      if (globalThis[${JSON.stringify(MEDIA_GUARD_SLOT)}] === guard) {
        delete globalThis[${JSON.stringify(MEDIA_GUARD_SLOT)}];
      }
      return result;
    });
  })()`;
}

function cancelScript(token: number): string {
  return `(() => {
    const guard = globalThis[${JSON.stringify(MEDIA_GUARD_SLOT)}];
    if (guard?.token === ${token}) {
      guard.cancel();
      delete globalThis[${JSON.stringify(MEDIA_GUARD_SLOT)}];
    }
    return { version: 1, token: ${token}, kind: "stale" };
  })()`;
}

function parseMediaGuardResult(
  value: unknown,
  token: number,
  kinds: MediaGuardKind[],
): { token: number; kind: MediaGuardKind } {
  if (
    isRecord(value) &&
    value.version === 1 &&
    value.token === token &&
    typeof value.kind === "string" &&
    kinds.includes(value.kind as MediaGuardKind)
  ) {
    return { token, kind: value.kind as MediaGuardKind };
  }
  throw new Error("Browser responsive appearance guard returned an invalid result.");
}

function hasForcedColorScheme(request: BrowserResponsiveRequest): boolean {
  return request.enabled && request.colorScheme !== "system";
}

function isDestroyedContextError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /context.*destroyed|frame.*detached|webcontents.*destroyed/i.test(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
