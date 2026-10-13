import { useCallback, useEffect, useMemo, useState } from "react";
import { SIDEBAR_EXPANDED_PROJECTS_KEY, usePersistedIdSet } from "@/hooks/usePersistedIdSet";

interface ProjectExpansion {
  expandedIds: ReadonlySet<number>;
  setExpanded: (projectId: number, expanded: boolean) => void;
}

/**
 * Which sidebar projects are expanded. Explicit toggles are persisted; the
 * active project's auto-expansion stays local to the session, so collapsing it
 * sticks across reloads and merely visiting a project writes nothing.
 */
export function useProjectExpansion(activeProjectId: number | null | undefined): ProjectExpansion {
  const persisted = usePersistedIdSet(SIDEBAR_EXPANDED_PROJECTS_KEY);
  const { setMember } = persisted;
  const [autoExpanded, setAutoExpanded] = useState<ReadonlySet<number>>(() => new Set());

  useEffect(() => {
    if (activeProjectId == null) return;
    setAutoExpanded((previous) =>
      previous.has(activeProjectId) ? previous : new Set(previous).add(activeProjectId),
    );
  }, [activeProjectId]);

  const expandedIds = useMemo(
    () => (autoExpanded.size === 0 ? persisted.ids : new Set([...persisted.ids, ...autoExpanded])),
    [autoExpanded, persisted.ids],
  );

  const setExpanded = useCallback(
    (projectId: number, expanded: boolean): void => {
      if (!expanded) {
        setAutoExpanded((previous) => {
          if (!previous.has(projectId)) return previous;
          const next = new Set(previous);
          next.delete(projectId);
          return next;
        });
      }
      setMember(projectId, expanded);
    },
    [setMember],
  );

  return useMemo(() => ({ expandedIds, setExpanded }), [expandedIds, setExpanded]);
}
