import { PLATFORM_IS_MAC } from "@/lib/shortcuts/format";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";

/**
 * Holds the (navItem, badge) ref pairs for every sidebar row that opted in
 * via `useNavShortcutHint`. The provider runs the keyboard listeners and
 * toggles each registered badge directly through its ref — no DOM queries
 * are performed.
 *
 * Render order in the DOM is the activation order: pressing `⌘1` activates
 * the first registered nav item (after sorting by `compareDocumentPosition`),
 * `⌘2` the second, and so on, up to nine.
 */

const STALE_MODIFIER_HINT_MS = 1_000;
const NAV_SHORTCUT_CODES = [
  "Digit1",
  "Digit2",
  "Digit3",
  "Digit4",
  "Digit5",
  "Digit6",
  "Digit7",
  "Digit8",
  "Digit9",
] as const;
const DEFAULT_NAV_SHORTCUT_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

interface KeyboardLayoutMapLike {
  get(code: string): string | undefined;
}

interface KeyboardApiLike {
  getLayoutMap?: () => Promise<KeyboardLayoutMapLike>;
}

interface NavigatorWithKeyboard extends Navigator {
  keyboard?: KeyboardApiLike;
}

interface ShortcutHintRegistration {
  navRef: RefObject<HTMLElement | null>;
  badgeRef: RefObject<HTMLElement | null>;
}

interface ShortcutHintsApi {
  register(entry: ShortcutHintRegistration): () => void;
}

const ShortcutHintsContext = createContext<ShortcutHintsApi | null>(null);

function shortcutIndex(event: KeyboardEvent, keys: readonly string[]): number | null {
  const modifier = PLATFORM_IS_MAC
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
  if (!modifier || event.altKey || event.shiftKey) return null;
  const index = keys.indexOf(event.key);
  return index >= 0 ? index : null;
}

function isAppSwitcherShortcut(event: KeyboardEvent): boolean {
  return event.key === "Tab" && event.metaKey && !event.ctrlKey && !event.altKey;
}

/** Order registered entries by their nav element's DOM position. */
function orderedEntries(
  entries: ReadonlySet<ShortcutHintRegistration>,
): ShortcutHintRegistration[] {
  const live: { entry: ShortcutHintRegistration; nav: HTMLElement }[] = [];
  for (const entry of entries) {
    const nav = entry.navRef.current;
    if (nav) live.push({ entry, nav });
  }
  live.sort((a, b) => {
    const cmp = a.nav.compareDocumentPosition(b.nav);
    if (cmp & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (cmp & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
  return live.map(({ entry }) => entry);
}

function paintBadges(
  entries: ShortcutHintRegistration[],
  visible: boolean,
  keys: readonly string[],
): void {
  // Reset every badge first. `data-visible="false"` drives opacity, so
  // the fade-out transition runs.
  for (const entry of entries) {
    const badge = entry.badgeRef.current;
    if (!badge) continue;
    badge.dataset.visible = "false";
    badge.textContent = "";
  }
  if (!visible) return;
  entries.slice(0, 9).forEach((entry, index) => {
    const badge = entry.badgeRef.current;
    if (!badge) return;
    badge.textContent = keys[index] ?? String(index + 1);
    badge.dataset.visible = "true";
  });
}

async function readNavShortcutKeys(): Promise<readonly string[]> {
  const keyboard = (navigator as NavigatorWithKeyboard).keyboard;
  const layoutMap = await keyboard?.getLayoutMap?.();
  if (!layoutMap) return DEFAULT_NAV_SHORTCUT_KEYS;
  return NAV_SHORTCUT_CODES.map(
    (code, index) => layoutMap.get(code) ?? DEFAULT_NAV_SHORTCUT_KEYS[index],
  );
}

function sameShortcutKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}

interface ShortcutHintsProviderProps {
  enabled: boolean;
  children: ReactNode;
}

function useShortcutHintListeners({
  enabled,
  entriesRef,
  hintsVisibleRef,
  staleHideTimerRef,
  shortcutKeysRef,
}: {
  enabled: boolean;
  entriesRef: RefObject<Set<ShortcutHintRegistration>>;
  hintsVisibleRef: RefObject<boolean>;
  staleHideTimerRef: RefObject<number | null>;
  shortcutKeysRef: RefObject<readonly string[]>;
}): void {
  useEffect(() => {
    const clearStaleHideTimer = (): void => {
      if (staleHideTimerRef.current == null) return;
      window.clearTimeout(staleHideTimerRef.current);
      staleHideTimerRef.current = null;
    };
    const ordered = (): ShortcutHintRegistration[] => orderedEntries(entriesRef.current);
    const showHints = (): void => {
      if (hintsVisibleRef.current) return;
      paintBadges(ordered(), true, shortcutKeysRef.current);
      hintsVisibleRef.current = true;
    };
    const refreshHints = (): void => {
      if (!hintsVisibleRef.current) return;
      paintBadges(ordered(), true, shortcutKeysRef.current);
    };
    const hideHints = (): void => {
      clearStaleHideTimer();
      if (!hintsVisibleRef.current) return;
      paintBadges(ordered(), false, shortcutKeysRef.current);
      hintsVisibleRef.current = false;
    };
    const scheduleStaleHide = (): void => {
      clearStaleHideTimer();
      staleHideTimerRef.current = window.setTimeout(() => {
        staleHideTimerRef.current = null;
        hideHints();
      }, STALE_MODIFIER_HINT_MS);
    };
    if (!enabled) {
      hideHints();
      return;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (isAppSwitcherShortcut(event)) {
        hideHints();
        return;
      }
      if ((PLATFORM_IS_MAC ? event.metaKey : event.ctrlKey) && !hintsVisibleRef.current) {
        showHints();
        scheduleStaleHide();
      }
      const index = shortcutIndex(event, shortcutKeysRef.current);
      if (index == null) return;
      const target = ordered()[index]?.navRef.current;
      if (!target) return;
      event.preventDefault();
      target.click();
      requestAnimationFrame(refreshHints);
    };
    const handleKeyUp = (event: KeyboardEvent): void => {
      if (event.key === (PLATFORM_IS_MAC ? "Meta" : "Control")) hideHints();
    };
    const handleWindowFocusChange = (): void => hideHints();
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    window.addEventListener("blur", handleWindowFocusChange);
    window.addEventListener("focus", handleWindowFocusChange);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      window.removeEventListener("blur", handleWindowFocusChange);
      window.removeEventListener("focus", handleWindowFocusChange);
      hideHints();
    };
  }, [enabled, entriesRef, hintsVisibleRef, shortcutKeysRef, staleHideTimerRef]);
}

/**
 * Mounts the keyboard listeners that show/hide the numeric shortcut hints
 * on every registered sidebar row. Children call `useNavShortcutHint()` to
 * register a (navItem, badge) ref pair.
 */
export function ShortcutHintsProvider({
  enabled,
  children,
}: ShortcutHintsProviderProps): ReactElement {
  const entriesRef = useRef<Set<ShortcutHintRegistration>>(new Set());
  const hintsVisibleRef = useRef(false);
  const staleHideTimerRef = useRef<number | null>(null);
  const shortcutKeysRef = useRef<readonly string[]>(DEFAULT_NAV_SHORTCUT_KEYS);

  const api = useMemo<ShortcutHintsApi>(
    () => ({
      register(entry) {
        entriesRef.current.add(entry);
        return () => {
          entriesRef.current.delete(entry);
        };
      },
    }),
    [],
  );

  useShortcutHintListeners({
    enabled,
    entriesRef,
    hintsVisibleRef,
    staleHideTimerRef,
    shortcutKeysRef,
  });

  useEffect(() => {
    let cancelled = false;
    void readNavShortcutKeys().then((keys) => {
      if (cancelled) return;
      if (sameShortcutKeys(shortcutKeysRef.current, keys)) return;
      shortcutKeysRef.current = keys;
      if (hintsVisibleRef.current) paintBadges(orderedEntries(entriesRef.current), true, keys);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return <ShortcutHintsContext.Provider value={api}>{children}</ShortcutHintsContext.Provider>;
}

/**
 * Hook for a sidebar nav row that wants a numeric shortcut hint badge.
 * Returns refs to attach to (a) the clickable nav element and (b) the
 * `SidebarShortcutBadge` rendered inside it. Registration is automatic.
 *
 * The nav ref is generic so consumers can attach it to a `<div>`,
 * `<button>`, etc. without casting. The registry only ever reads
 * `HTMLElement` methods on it.
 */
export function useNavShortcutHint<TNav extends HTMLElement = HTMLElement>(): {
  navRef: RefObject<TNav | null>;
  badgeRef: RefObject<HTMLSpanElement | null>;
} {
  const api = useContext(ShortcutHintsContext);
  const navRef = useRef<TNav | null>(null);
  const badgeRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!api) return;
    return api.register({
      navRef: navRef as RefObject<HTMLElement | null>,
      badgeRef,
    });
  }, [api]);

  return useMemo(() => ({ navRef, badgeRef }), []);
}
