import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { createTestQueryClient } from "@/test-utils";
import { getGetFeatureQueryKey, getListProjectsQueryKey, type Feature } from "@/api/generated";
import { SIDEBAR_ROW_ACTION_EVENT } from "@/lib/sidebar-row-actions";
import { useSessionStatusStore } from "@/stores/session-status-store";
import { useSidebarRenameStore } from "@/stores/sidebar-rename-store";
import { useUnreadStore } from "@/stores/unread-store";
import { SidebarAttentionProvider } from "./SidebarAttentionProvider";
import { SidebarAttentionShortcuts, useSidebarRowShortcuts } from "./SidebarShortcuts";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("@/lib/shortcuts/format", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  PLATFORM_IS_MAC: true,
}));

function seededClient() {
  const client = createTestQueryClient();
  client.setDefaultOptions({ queries: { staleTime: Infinity, retry: false } });
  client.setQueryData(getListProjectsQueryKey(), [{ id: 9, name: "p", path: "/p" }]);
  for (const id of [1, 2, 3]) {
    client.setQueryData(getGetFeatureQueryKey(id), {
      id,
      title: `F${id}`,
      project_id: 9,
      status: "active",
    } as Feature);
  }
  return client;
}

function openedFeatureIds(): unknown[] {
  return navigate.mock.calls.map(([options]) => options.search.featureId);
}

beforeEach(() => {
  navigate.mockReset();
  useUnreadStore.setState({ byFeature: {}, failedByFeature: {}, markedOrder: {} });
  useSessionStatusStore.setState({
    bySession: {
      10: { featureId: 2, status: "question", kind: "permission", seq: 1 },
      11: { featureId: 1, status: "question", kind: "question", seq: 5 },
    },
  });
  useUnreadStore.getState().markUnread(3);
});

describe("attention jump shortcuts", () => {
  it("⌘J walks the waiting queue oldest first, from the open conversation", async () => {
    const { user, rerender } = render(
      <SidebarAttentionProvider>
        <SidebarAttentionShortcuts activeFeatureId={null} onSelectFeature={vi.fn()} />
      </SidebarAttentionProvider>,
      { queryClient: seededClient() },
    );
    await user.keyboard("{Meta>}j{/Meta}");
    rerender(
      <SidebarAttentionProvider>
        <SidebarAttentionShortcuts activeFeatureId={2} onSelectFeature={vi.fn()} />
      </SidebarAttentionProvider>,
    );
    await user.keyboard("{Meta>}j{/Meta}");
    expect(openedFeatureIds()).toEqual([2, 1]);
  });

  it("⌥⌘J opens the next unread conversation", async () => {
    const { user } = render(
      <SidebarAttentionProvider>
        <SidebarAttentionShortcuts activeFeatureId={null} onSelectFeature={vi.fn()} />
      </SidebarAttentionProvider>,
      { queryClient: seededClient() },
    );
    await user.keyboard("{Meta>}{Alt>}j{/Alt}{/Meta}");
    expect(openedFeatureIds()).toEqual([3]);
  });
});

function RowHarness({ onAction }: { onAction: (action: string) => void }) {
  useSidebarRowShortcuts();
  return (
    <div data-focus-zone="left-sidebar">
      <div
        role="button"
        tabIndex={0}
        data-nav-type="feature"
        data-nav-id="7"
        ref={(node) =>
          node?.addEventListener(SIDEBAR_ROW_ACTION_EVENT, (event) => {
            const detail = (event as CustomEvent<{ action: string; handled: boolean }>).detail;
            detail.handled = true;
            onAction(detail.action);
          })
        }
      >
        Row
      </div>
    </div>
  );
}

describe("row shortcuts", () => {
  it("act on the focused conversation row", async () => {
    const onAction = vi.fn();
    const { user } = render(<RowHarness onAction={onAction} />);
    screen.getByRole("button", { name: "Row" }).focus();

    await user.keyboard("{Meta>}{Alt>}p{/Alt}{/Meta}");
    await user.keyboard("{Meta>}{Backspace}{/Meta}");
    await user.keyboard("{Meta>}{Alt>}l{/Alt}{/Meta}");
    expect(onAction.mock.calls.map(([action]) => action)).toEqual(["pin", "archive", "label"]);

    await user.keyboard("{Meta>}{Alt>}u{/Alt}{/Meta}");
    expect(useUnreadStore.getState().byFeature[7]).toBe(true);
    await user.keyboard("{Meta>}{Alt>}u{/Alt}{/Meta}");
    expect(useUnreadStore.getState().byFeature[7]).toBeUndefined();

    await user.keyboard("{F2}");
    expect(useSidebarRenameStore.getState().featureId).toBe(7);
  });

  it("do nothing without a focused row", async () => {
    const onAction = vi.fn();
    const { user } = render(<RowHarness onAction={onAction} />);
    await user.keyboard("{Meta>}{Alt>}p{/Alt}{/Meta}");
    expect(onAction).not.toHaveBeenCalled();
  });
});
