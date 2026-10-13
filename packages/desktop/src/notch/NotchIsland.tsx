import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { NotchAgent, NotchGeometry } from "@/shared/notch";
import { IndexDotsOrb } from "./IndexDotsOrb";
import { ambientAgents } from "./notch-ambient";
import { notchBridge } from "./notch-bridge";
import { aggregateOrbState, NotchPanel, PanelEars } from "./NotchPanel";
import { NotchPeek, PeekEars, peekTone } from "./NotchPeek";
import { useNotchFeed, type NotchFeed } from "./useNotchFeed";

type IslandMode = "idle" | "compact" | "peek" | "expanded";

const EAR_WIDTH = 52;
const PEEK_WIDTH = 440;
const PANEL_WIDTH = 540;
const RADII: Record<IslandMode, number> = { idle: 10, compact: 13, peek: 24, expanded: 28 };
/** Slack around the drawn shape the pointer may stray into before the island lets go. */
const HOT_SLACK = 10;
const MAX_COMPACT_DOTS = 4;

interface IslandSize {
  width: number;
  height: number;
}

/**
 * Peek wins over the list unless the user was already browsing it; a peek the
 * pointer lands on is *held* (countdown paused, clickable) rather than swapped
 * for the list under the cursor.
 */
function useIslandMode(feed: NotchFeed, hasAmbient: boolean): { mode: IslandMode; held: boolean } {
  const { engaged, peek, prefs } = feed;
  // Only the moment of engagement decides between holding a peek and browsing.
  // Decided while rendering, so the panel never flashes in for a frame first.
  const [hold, setHold] = useState<{ engaged: boolean; peekId: string | null }>({
    engaged,
    peekId: null,
  });
  let holdPeekId = hold.peekId;
  if (hold.engaged !== engaged) {
    holdPeekId = engaged ? (peek?.id ?? null) : null;
    setHold({ engaged, peekId: holdPeekId });
  }

  const held = peek != null && holdPeekId === peek.id;
  if (peek && (!engaged || held)) return { mode: "peek", held };
  if (engaged) return { mode: "expanded", held: false };
  // Out while something needs a glance; "always on" off tucks it away between peeks.
  return { mode: prefs.alwaysOn && hasAmbient ? "compact" : "idle", held: false };
}

interface BodyHeights {
  peek: number;
  panel: number;
}

function islandSize(mode: IslandMode, geometry: NotchGeometry, bodies: BodyHeights): IslandSize {
  const { notchWidth, notchHeight } = geometry;
  switch (mode) {
    case "idle":
      return { width: notchWidth, height: notchHeight };
    case "compact":
      return { width: notchWidth + EAR_WIDTH * 2, height: notchHeight };
    case "peek":
      return { width: Math.max(PEEK_WIDTH, notchWidth + 200), height: notchHeight + bodies.peek };
    case "expanded":
      return {
        width: Math.max(PANEL_WIDTH, notchWidth + 300),
        height: Math.min(geometry.windowHeight - 24, notchHeight + bodies.panel),
      };
  }
}

/** Tell the main process where the pointer counts as "on the island" (in points). */
function useHotRect(
  size: IslandSize,
  viewportWidth: number,
  onError: (error: unknown) => void,
): void {
  const { width, height } = size;
  useEffect(() => {
    notchBridge()
      .setHotRect({
        x: (viewportWidth - width) / 2 - HOT_SLACK,
        y: 0,
        width: width + HOT_SLACK * 2,
        height: height + HOT_SLACK,
      })
      .catch(onError);
  }, [height, width, viewportWidth, onError]);
}

/** Aggregate orb (or the plain logo when still) + one dot per agent. */
function CompactEars({
  agents,
  still,
}: {
  agents: readonly NotchAgent[];
  still: boolean;
}): React.JSX.Element {
  const shown = agents.slice(0, MAX_COMPACT_DOTS);
  const extra = agents.length - shown.length;
  return (
    <>
      <span className="ear">
        <IndexDotsOrb state={still ? "logo" : aggregateOrbState(agents)} />
      </span>
      <span className="ear compact-dots" data-still={still} aria-label={`${agents.length} agents`}>
        {shown.map((agent, i) => (
          <span
            key={agent.featureId}
            className="compact-dot"
            data-status={agent.status}
            style={{ "--i": i } as CSSProperties}
          />
        ))}
        {extra > 0 ? <span className="compact-count">+{extra}</span> : null}
      </span>
    </>
  );
}

function Layer({
  active,
  width,
  bandHeight,
  ears,
  children,
}: {
  active: boolean;
  width: number;
  bandHeight: number;
  ears: React.ReactNode;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="layer" data-active={active} style={{ width }} aria-hidden={!active}>
      <div className="ears" style={{ height: bandHeight }}>
        {ears}
      </div>
      {children}
    </div>
  );
}

function useIslandActions(reportError: (error: unknown) => void) {
  const open = useCallback(
    (featureId: number | null, projectId: number | null) => {
      if (featureId == null || projectId == null) return;
      notchBridge().openFeature({ featureId, projectId }).catch(reportError);
    },
    [reportError],
  );
  const openAgent = useCallback(
    (agent: NotchAgent) => open(agent.featureId, agent.projectId),
    [open],
  );
  const dismissAgent = useCallback(
    (agent: NotchAgent) => {
      notchBridge()
        .dismiss({ featureId: agent.featureId, projectId: agent.projectId })
        .catch(reportError);
    },
    [reportError],
  );

  return { open, openAgent, dismissAgent };
}

/** The shape contracts on a quicker, overshoot-free curve than it grows on. */
function useShrinking(area: number): boolean {
  const previousArea = useRef(0);
  const shrinking = area < previousArea.current;
  useEffect(() => {
    previousArea.current = area;
  }, [area]);
  return shrinking;
}

export function NotchIsland(): React.JSX.Element | null {
  const feed = useNotchFeed();
  // Nothing to draw, and no hot rect to report, until main has placed the window.
  return feed.geometry ? <IslandView feed={feed} geometry={feed.geometry} /> : null;
}

function IslandView({
  feed,
  geometry,
}: {
  feed: NotchFeed;
  geometry: NotchGeometry;
}): React.JSX.Element {
  const { snapshot, peek, dropPeek, reportError } = feed;
  const ambient = useMemo(() => ambientAgents(snapshot.agents), [snapshot.agents]);
  const { mode, held } = useIslandMode(feed, ambient.length > 0);
  const [panelHeight, setPanelHeight] = useState(120);
  const [peekHeight, setPeekHeight] = useState(104);
  const bodies = { peek: peekHeight, panel: panelHeight };
  const { open, openAgent, dismissAgent } = useIslandActions(reportError);
  // Ambient calm: the closed island only animates with "Always animate" on. Not gated on
  // the mode, so the compact layer keeps the logo while it fades out under a peek or panel.
  const still = !feed.prefs.alwaysAnimate;

  const size = islandSize(mode, geometry, bodies);
  useHotRect(size, geometry.windowWidth, reportError);
  const shrinking = useShrinking(size.width * size.height);

  const band = geometry.notchHeight;
  const peekAgent =
    peek?.featureId != null
      ? snapshot.agents.find((agent) => agent.featureId === peek.featureId)
      : undefined;
  const tone = peek ? peekTone(peek, peekAgent) : "done";

  return (
    <div
      className="island"
      data-mode={mode}
      data-shrinking={shrinking}
      data-hidden={mode === "idle" && !geometry.hardware}
      style={
        {
          "--iw": `${size.width}px`,
          "--ih": `${size.height}px`,
          "--ir": `${RADII[mode]}px`,
          "--tone": `var(--n-${tone})`,
        } as CSSProperties
      }
    >
      <div className="island-glow" />
      <div className="island-body" />
      <span className="island-shoulder" data-side="left" />
      <span className="island-shoulder" data-side="right" />

      <Layer
        active={mode === "compact"}
        width={islandSize("compact", geometry, bodies).width}
        bandHeight={band}
        ears={<CompactEars agents={ambient} still={still} />}
      />
      <Layer
        active={mode === "peek"}
        width={islandSize("peek", geometry, bodies).width}
        bandHeight={band}
        ears={peek ? <PeekEars notification={peek} tone={tone} /> : null}
      >
        {peek ? (
          <NotchPeek
            key={peek.id}
            notification={peek}
            agent={peekAgent}
            paused={held}
            tone={tone}
            onOpen={() => {
              open(peek.featureId, peek.projectId);
              dropPeek(peek.id);
            }}
            onExpire={() => dropPeek(peek.id)}
            onHeight={setPeekHeight}
          />
        ) : null}
      </Layer>
      <Layer
        active={mode === "expanded"}
        width={islandSize("expanded", geometry, bodies).width}
        bandHeight={band}
        ears={<PanelEars agents={snapshot.agents} />}
      >
        <NotchPanel
          agents={snapshot.agents}
          active={mode === "expanded"}
          error={feed.error}
          onOpen={openAgent}
          onDismiss={dismissAgent}
          onHeight={setPanelHeight}
        />
      </Layer>
    </div>
  );
}
