import { useEffect, useRef, type CSSProperties } from "react";
import { useReportHeight } from "./useReportHeight";
import type { NotchAgent, NotchNotification } from "@/shared/notch";
import { IndexDotsOrb } from "./IndexDotsOrb";
import { NotchTile } from "./NotchTile";

const PEEK_MS: Record<NotchNotification["status"], number> = {
  completed: 6_500,
  needs_input: 10_000,
  error: 10_000,
};

/** Accent of a peek; each maps to a `--n-<tone>` color and a `.tone-<tone>` class. */
export type NotchTone = "done" | "error" | "question" | "permission";

export function peekTone(
  notification: NotchNotification,
  agent: NotchAgent | undefined,
): NotchTone {
  if (notification.status === "completed") return "done";
  if (notification.status === "error") return "error";
  return agent?.pendingKind === "question" ? "question" : "permission";
}

const STATUS_LABEL: Record<NotchNotification["status"], string> = {
  completed: "Done",
  needs_input: "Needs you",
  error: "Failed",
};

/**
 * Auto-dismiss that pauses while the pointer holds the peek and resumes with
 * the time that was left — in step with the CSS drain bar, which pauses too.
 * The peek is keyed by notification, so a new one starts a fresh countdown.
 */
function usePeekCountdown(totalMs: number, paused: boolean, onExpire: () => void) {
  const remaining = useRef(totalMs);
  const expire = useRef(onExpire);
  expire.current = onExpire;

  useEffect(() => {
    if (paused) return;
    const startedAt = Date.now();
    const timer = setTimeout(() => expire.current(), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt));
    };
  }, [paused]);
}

/** Top band of the peek, beside the cutout. */
export function PeekEars({
  notification,
  tone,
}: {
  notification: NotchNotification;
  tone: NotchTone;
}): React.JSX.Element {
  return (
    <>
      <span className="ear">
        <IndexDotsOrb state={notification.status === "completed" ? "done" : "question"} />
      </span>
      <span className={`ear ear-meta tone-${tone}`}>{STATUS_LABEL[notification.status]}</span>
    </>
  );
}

export function NotchPeek({
  notification,
  agent,
  paused,
  tone,
  onOpen,
  onExpire,
  onHeight,
}: {
  notification: NotchNotification;
  agent: NotchAgent | undefined;
  paused: boolean;
  tone: NotchTone;
  onOpen: () => void;
  onExpire: () => void;
  onHeight: (height: number) => void;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useReportHeight(ref, onHeight);
  const totalMs = PEEK_MS[notification.status];
  usePeekCountdown(totalMs, paused, onExpire);
  const clickable = notification.featureId != null;
  const meta = [agent?.projectName, agent?.providerLabel].filter(Boolean).join(" · ");
  return (
    <div
      ref={ref}
      className="peek"
      data-static={!clickable}
      data-paused={paused}
      role={clickable ? "button" : undefined}
      onClick={clickable ? onOpen : undefined}
      style={{ "--peek-ms": `${totalMs}ms` } as CSSProperties}
    >
      <NotchTile
        size="lg"
        agent={{
          status: notification.status === "completed" ? "done" : "question",
          pendingKind: agent?.pendingKind ?? "permission",
          providerIconSrc: agent?.providerIconSrc ?? null,
          providerIconMono: agent?.providerIconMono ?? false,
          providerLabel: agent?.providerLabel ?? null,
          unread: notification.status === "completed",
        }}
      />
      <div className="peek-head">
        <div className="peek-title">{notification.title}</div>
        <div className="peek-meta">{meta || "Cadencr"}</div>
      </div>
      {notification.body ? <p className="peek-body">{notification.body}</p> : null}
      <span className={`peek-drain tone-${tone}`} />
    </div>
  );
}
