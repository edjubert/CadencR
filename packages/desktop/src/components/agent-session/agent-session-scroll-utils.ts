import type { FollowOutputCallback, VirtuosoHandle } from "react-virtuoso";
import { STREAM_BOTTOM_GAP_PX } from "./stream-fade";

export type ScrollRef = (el: HTMLElement | null) => void;

export const HISTORY_SCROLL_TOP_PX = 160;
export const SCROLLBAR_HIT_TARGET_PX = 20;
// The initial agent-state window is intentionally small (see
// `AGENT_STATE_INITIAL_MESSAGE_LIMIT`) so latest-message + status paint
// instantly. If that window doesn't fill the viewport there's no scrollbar, so
// the user can't scroll up to reach older history. This caps how many pages we
// auto-prepend to produce a scrollbar before giving up (a pathological run of
// tiny collapsed rows).
export const MAX_VIEWPORT_FILL_PAGES = 6;

export function canScroll(el: HTMLElement): boolean {
  return el.scrollHeight > el.clientHeight;
}

/**
 * `canScroll` for the agent-stream scroller, which always carries a blank
 * `STREAM_BOTTOM_GAP_PX` spacer under the last message.
 *
 * That spacer is scrollable but empty, so the raw check reports overflow on a
 * conversation that visually fits — and every "did the user mean to scroll?"
 * gate hangs off it. Left unsubtracted, a stray wheel-up on a short session
 * disengages bottom-stick, and viewport backfill of older history stops before
 * it starts. Other scrollers (`useStickToBottom`) have no such spacer and want
 * the raw check.
 */
export function canScrollStream(el: HTMLElement): boolean {
  return el.scrollHeight - STREAM_BOTTOM_GAP_PX > el.clientHeight;
}

/**
 * WebKit reports a fractional `scrollTop` while `scrollHeight`/`clientHeight`
 * are rounded, so "is it at the bottom" needs slack rather than equality.
 */
export const PIN_EPSILON_PX = 1;

/**
 * Scroll `el` to the bottom, skipping the write when it is already there.
 *
 * Idempotence is the point, not an optimization: a redundant `scrollTop` write
 * still emits a `scroll` event, and every scroll consumer in the agent stream
 * (Virtuoso's own range recompute included) reacts to it. Writing on a loop
 * that a scroll event feeds is what wedged the iOS PWA — see `observeListGrowth`.
 */
export function pinToBottom(el: HTMLElement): void {
  const target = Math.max(0, el.scrollHeight - el.clientHeight);
  if (target - el.scrollTop <= PIN_EPSILON_PX) return;
  el.scrollTop = target;
}

export function isVerticalScrollbarPointer(el: HTMLElement, e: PointerEvent): boolean {
  const rect = el.getBoundingClientRect();
  return e.clientX >= rect.right - SCROLLBAR_HIT_TARGET_PX && e.clientX <= rect.right + 1;
}

export interface HistoryAnchor {
  scrollTop: number;
  scrollHeight: number;
}

export interface UseAgentSessionScrollResult {
  virtuosoRef: React.RefObject<VirtuosoHandle | null>;
  scrollContainerRef: ScrollRef;
  onStartReached: () => void;
  followOutput: FollowOutputCallback;
  onAtBottomStateChange: (atBottom: boolean) => void;
  onTotalListHeightChanged: (height: number) => void;
  autoScrollEnabled: boolean;
  isLoadingOlder: boolean;
  scrollToBottom: () => void;
}
