import type { NotchAgent } from "@/shared/notch";

/**
 * The agents that keep the closed island out beside the notch: one at work,
 * one waiting on you, or a finished one whose reply you haven't read. A read,
 * finished agent stays in the hover list but no longer holds the island open.
 */
export function ambientAgents(agents: readonly NotchAgent[]): NotchAgent[] {
  return agents.filter((agent) => agent.status !== "done" || agent.unread);
}
