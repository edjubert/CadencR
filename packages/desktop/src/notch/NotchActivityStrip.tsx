import { memo, type CSSProperties } from "react";
import type { NotchAgent } from "@/shared/notch";
import { aggregateOrbState } from "./NotchPanel";

/** A three-point status mark on the left, with tiny session status circles on the right. */
export const NotchActivityStrip = memo(function NotchActivityStrip({
  agents,
  still,
}: {
  agents: readonly NotchAgent[];
  still: boolean;
}): React.JSX.Element {
  const working = agents.filter((agent) => agent.status === "running").length;
  const waiting = agents.filter((agent) => agent.status === "question").length;
  const unread = agents.length - working - waiting;
  return (
    <div
      className="activity-strip"
      data-still={still}
      role="img"
      aria-label={`${working} working, ${waiting} waiting, ${unread} unread`}
    >
      <span className="activity-logo" data-state={aggregateOrbState(agents)} aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <span key={index} className="activity-logo-point" />
        ))}
      </span>
      <span className="activity-statuses" aria-hidden="true">
        {agents.map((agent, index) => (
          <span
            key={agent.featureId}
            className="activity-segment"
            data-status={agent.status}
            data-kind={agent.pendingKind}
            style={{ "--i": index } as CSSProperties}
          />
        ))}
      </span>
    </div>
  );
});
