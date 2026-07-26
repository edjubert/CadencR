import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWsSessionStore } from "./ws-session-store";

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.OPEN;
  private listeners: Record<string, Array<(...args: unknown[]) => void>> = {};

  constructor(_url: string) {
    MockWebSocket.instances.push(this);
    Promise.resolve().then(() => this.fireEvent("open"));
  }

  addEventListener(event: string, cb: (...args: unknown[]) => void): void {
    (this.listeners[event] ??= []).push(cb);
  }

  removeEventListener(): void {}

  send(_data: string): void {}

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
  }

  simulateMessage(envelope: { domain: string; action: string; payload: unknown }): void {
    this.fireEvent("message", { data: JSON.stringify({ id: "srv-1", ...envelope }) });
  }

  private fireEvent(event: string, data?: unknown): void {
    for (const cb of this.listeners[event] ?? []) {
      cb(data ?? {});
    }
  }

  static reset(): void {
    MockWebSocket.instances = [];
  }
}

function latestWs(): MockWebSocket {
  return MockWebSocket.instances[MockWebSocket.instances.length - 1];
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

beforeEach(() => {
  MockWebSocket.reset();
  useWsSessionStore.setState({ sessions: {} });
  vi.stubGlobal("WebSocket", MockWebSocket);
  vi.stubGlobal("window", { ...globalThis.window });
});

afterEach(() => {
  const store = useWsSessionStore.getState();
  for (const sessionId of Object.keys(store.sessions)) {
    store.disconnect(sessionId);
  }
  vi.restoreAllMocks();
});

describe("ws-session usage updates", () => {
  it("preserves the previous context window when usage_update omits it", async () => {
    const store = useWsSessionStore.getState();
    store.connect("s1");
    await tick();
    store.setPersistedState("s1", {
      blocks: [],
      lifecycle: { phase: "idle" },
      contextUsage: {
        inputTokens: 100,
        outputTokens: 25,
        contextWindow: 200_000,
        wasCompacted: false,
        costUsd: null,
      },
    });

    latestWs().simulateMessage({
      domain: "session",
      action: "usage_update",
      payload: { input_tokens: 150, output_tokens: 50 },
    });

    expect(useWsSessionStore.getState().sessions.s1.contextUsage).toEqual({
      inputTokens: 150,
      outputTokens: 50,
      contextWindow: 200_000,
      wasCompacted: false,
      costUsd: null,
    });
  });

  it("upgrades the context window when a later usage_update reports it", async () => {
    const store = useWsSessionStore.getState();
    store.connect("s1");
    await tick();
    store.setPersistedState("s1", {
      blocks: [],
      lifecycle: { phase: "idle" },
      contextUsage: {
        inputTokens: 100,
        outputTokens: 25,
        contextWindow: null,
        wasCompacted: false,
        costUsd: null,
      },
    });

    latestWs().simulateMessage({
      domain: "session",
      action: "usage_update",
      payload: { input_tokens: 150, output_tokens: 50, context_window: 1_000_000 },
    });

    expect(useWsSessionStore.getState().sessions.s1.contextUsage).toEqual({
      inputTokens: 150,
      outputTokens: 50,
      contextWindow: 1_000_000,
      wasCompacted: false,
      costUsd: null,
    });
  });
});
