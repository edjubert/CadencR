import { describe, expect, it } from "vitest";
import type { NotchAgent } from "@/shared/notch";
import { ambientAgents } from "./notch-ambient";

function agent(featureId: number, status: NotchAgent["status"], unread = false): NotchAgent {
  return {
    featureId,
    projectId: 1,
    title: `Agent ${featureId}`,
    projectName: "cadencr",
    status,
    pendingKind: status === "question" ? "permission" : null,
    providerLabel: null,
    providerIconSrc: null,
    providerIconMono: false,
    turnStartedAtMs: null,
    lastActivityAtMs: null,
    lastAction: null,
    preview: null,
    unread,
  };
}

describe("ambientAgents", () => {
  it("keeps working, waiting and unread agents, drops read finished ones", () => {
    const agents = [
      agent(1, "running"),
      agent(2, "question"),
      agent(3, "done", true),
      agent(4, "done"),
    ];
    expect(ambientAgents(agents).map((a) => a.featureId)).toEqual([1, 2, 3]);
  });

  it("is empty once the last agent finished and was read", () => {
    expect(ambientAgents([agent(4, "done")])).toEqual([]);
  });
});
