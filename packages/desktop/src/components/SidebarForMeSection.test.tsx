import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@/test-utils";
import { getGetFeatureQueryKey, type Feature } from "@/api/generated";
import { createTestQueryClient } from "@/test-utils";
import { DEFAULT_SIDEBAR_CONFIG } from "@/lib/sidebar-config";
import { useSessionStatusStore } from "@/stores/session-status-store";
import { useSidebarConfigStore } from "@/stores/sidebar-config-store";
import { useSidebarFilterStore } from "@/stores/sidebar-filter-store";
import { useUnreadStore } from "@/stores/unread-store";
import { SidebarAttentionProvider } from "./SidebarAttentionProvider";
import { SidebarForMeSection } from "./SidebarForMeSection";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/components/PinnedConversationRow", () => ({
  PinnedConversationRow: ({ feature }: { feature: Feature }) => (
    <div role="row">{feature.title}</div>
  ),
}));

function seededClient() {
  const client = createTestQueryClient();
  client.setDefaultOptions({ queries: { staleTime: Infinity, retry: false } });
  client.setQueryData(["/api/projects"], []);
  for (const [id, title] of [
    [1, "Asks permission"],
    [2, "Finished"],
    [3, "Still working"],
    [4, "Crashed"],
    [5, "Asked first"],
  ] as const) {
    client.setQueryData(getGetFeatureQueryKey(id), {
      id,
      title,
      project_id: 9,
      status: "active",
    } as Feature);
  }
  return client;
}

function renderSection() {
  return render(
    <SidebarAttentionProvider>
      <SidebarForMeSection activeFeatureId={null} onSelectFeature={vi.fn()} />
    </SidebarAttentionProvider>,
    { queryClient: seededClient() },
  );
}

beforeEach(() => {
  useSidebarConfigStore.setState({ config: DEFAULT_SIDEBAR_CONFIG });
  useSidebarFilterStore.getState().close();
  useUnreadStore.setState({ byFeature: {}, failedByFeature: {}, markedOrder: {} });
  useSessionStatusStore.setState({
    bySession: {
      10: { featureId: 1, status: "question", kind: "permission", seq: 8 },
      11: { featureId: 3, status: "agent", kind: null, seq: 9 },
      12: { featureId: 5, status: "question", kind: "question", seq: 2 },
    },
  });
  useUnreadStore.getState().markUnread(2);
  useUnreadStore.getState().markFailed(4);
});

describe("SidebarForMeSection", () => {
  it("queues pending requests oldest first, then failures, then unread, without working agents", () => {
    renderSection();
    const section = screen.getByRole("region", { name: "For me" });
    expect(
      within(section)
        .getAllByRole("row")
        .map((row) => row.textContent),
    ).toEqual(["Asked first", "Asks permission", "Crashed", "Finished"]);
    expect(within(section).getByRole("button", { name: /For me/ })).toHaveTextContent("4");
  });

  it("drops a conversation once it is read and hides when the queue empties", () => {
    renderSection();
    act(() => {
      useUnreadStore.getState().markRead(2);
      useUnreadStore.getState().markRead(4);
      useSessionStatusStore.setState({ bySession: {} });
    });
    expect(screen.queryByRole("region", { name: "For me" })).not.toBeInTheDocument();
  });

  it("doesn't flash while only an agent at work is being looked up", () => {
    useUnreadStore.setState({ byFeature: {}, failedByFeature: {}, markedOrder: {} });
    useSessionStatusStore.setState({
      bySession: { 20: { featureId: 99, status: "agent", kind: null, seq: 1 } },
    });
    renderSection();
    expect(screen.queryByRole("region", { name: "For me" })).not.toBeInTheDocument();
  });

  it("stays hidden when switched off or while filtering", () => {
    useSidebarConfigStore.setState({ config: { ...DEFAULT_SIDEBAR_CONFIG, forMe: false } });
    const { unmount } = renderSection();
    expect(screen.queryByRole("region", { name: "For me" })).not.toBeInTheDocument();
    unmount();

    useSidebarConfigStore.setState({ config: DEFAULT_SIDEBAR_CONFIG });
    useSidebarFilterStore.getState().start("x", null);
    renderSection();
    expect(screen.queryByRole("region", { name: "For me" })).not.toBeInTheDocument();
  });
});

describe("SidebarForMeSection blocks options", () => {
  it("keeps an empty block with its empty line when empty blocks are shown", () => {
    useSidebarConfigStore.setState({
      config: { ...DEFAULT_SIDEBAR_CONFIG, hideEmptyBlocks: false },
    });
    useUnreadStore.setState({ byFeature: {}, failedByFeature: {}, markedOrder: {} });
    useSessionStatusStore.setState({ bySession: {} });
    renderSection();
    const section = screen.getByRole("region", { name: "For me" });
    expect(section).toHaveTextContent("Nothing waiting on you");
  });

  it("swaps the count for a strong dot", () => {
    useSidebarConfigStore.setState({ config: { ...DEFAULT_SIDEBAR_CONFIG, blockCounts: "dot" } });
    renderSection();
    const header = screen.getByRole("button", { name: /For me/ });
    expect(header).not.toHaveTextContent(/\d/);
    expect(within(header).getByRole("img", { name: "4, 3 need an action" })).toHaveClass(
      "bg-amber-400",
    );
  });
});
