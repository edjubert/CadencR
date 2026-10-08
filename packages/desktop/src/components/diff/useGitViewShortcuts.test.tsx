import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@/test-utils";
import { FeatureLayoutProvider } from "@/components/feature-layout/FeatureLayoutContext";
import { ROOT_LEAF_ID, type TabKind } from "@/stores/feature-layout-schema";
import { useFeatureLayoutStore } from "@/stores/feature-layout-store";
import type { GitViewMode } from "./GitTabToggle";
import { useGitViewShortcuts } from "./useGitViewShortcuts";

const FEATURE_ID = 811;

function Harness({ onChange }: { onChange: (view: GitViewMode) => void }) {
  useGitViewShortcuts(onChange, true);
  return <div data-testid="surface" tabIndex={0} />;
}

function seedLayout(activeTab: TabKind): void {
  useFeatureLayoutStore.setState((state) => ({
    ...state,
    features: {
      ...state.features,
      [FEATURE_ID]: {
        version: 1,
        splitRoot: {
          type: "leaf",
          id: ROOT_LEAF_ID,
          tabIds: ["git", "editor"],
          activeTabId: activeTab,
        },
        focusedPaneId: ROOT_LEAF_ID,
        appliedLayoutId: null,
      },
    },
  }));
}

function dispatchMod(key: string, code: string, extras: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    code,
    metaKey: true,
    bubbles: true,
    cancelable: true,
    ...extras,
  });
  window.dispatchEvent(event);
  return event;
}

beforeEach(() => seedLayout("git"));

afterEach(() => {
  document.getSelection()?.removeAllRanges();
  document.querySelectorAll("[data-test-overlay]").forEach((element) => element.remove());
  useFeatureLayoutStore.setState((state) => {
    const features = { ...state.features };
    delete features[FEATURE_ID];
    return { ...state, features };
  });
});

describe("useGitViewShortcuts", () => {
  it.each([
    ["u", "KeyU", "uncommitted"],
    ["t", "KeyT", "vs-target"],
    ["p", "KeyP", "pr"],
    ["y", "KeyY", "graph"],
    ["l", "KeyL", "branches"],
    ["s", "KeyS", "stashes"],
  ] as const)("maps Mod+%s to %s", (key, code, expected) => {
    const onChange = vi.fn();
    render(
      <FeatureLayoutProvider featureId={FEATURE_ID}>
        <Harness onChange={onChange} />
      </FeatureLayoutProvider>,
    );

    const event = dispatchMod(key, code);

    expect(onChange).toHaveBeenCalledWith(expected);
    expect(event.defaultPrevented).toBe(true);
  });

  it("matches produced letters instead of QWERTY physical positions", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    // ⌘Z is unbound in this scope, so only the produced-letter match can fire.
    dispatchMod("t", "KeyZ");
    dispatchMod("z", "KeyT");

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith("vs-target");
  });

  it("yields Mod+S to CodeMirror and ignores repeats and open overlays", () => {
    const onChange = vi.fn();
    const { getByTestId } = render(
      <>
        <Harness onChange={onChange} />
        <div className="cm-editor" data-testid="editor" tabIndex={0} />
      </>,
    );
    getByTestId("editor").focus();
    fireEvent.keyDown(getByTestId("editor"), { key: "s", code: "KeyS", metaKey: true });
    dispatchMod("s", "KeyS", { repeat: true });
    const overlay = document.createElement("div");
    overlay.dataset.testOverlay = "menu";
    overlay.dataset.slot = "dropdown-menu-content";
    overlay.dataset.state = "open";
    overlay.setAttribute("role", "menu");
    document.body.append(overlay);
    dispatchMod("s", "KeyS");

    expect(onChange).not.toHaveBeenCalled();
  });

  it("still switches views while diff text is selected", () => {
    const onChange = vi.fn();
    const { getByTestId } = render(
      <>
        <Harness onChange={onChange} />
        <p data-testid="selected">a line of the diff</p>
      </>,
    );
    // Reading a diff means selecting bits of it, and the selection is
    // document-wide and sticky — it outlives the tab you made it in. Letting it
    // veto a ⌘-chord left the whole sub-view strip unreachable from the
    // keyboard for the rest of the session.
    const range = document.createRange();
    range.selectNodeContents(getByTestId("selected"));
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    dispatchMod("y", "KeyY");

    expect(onChange).toHaveBeenCalledWith("graph");
  });

  it("does not let an inactive Git pane retain shortcut ownership", () => {
    const onChange = vi.fn();
    seedLayout("editor");
    render(
      <FeatureLayoutProvider featureId={FEATURE_ID}>
        <Harness onChange={onChange} />
      </FeatureLayoutProvider>,
    );

    dispatchMod("u", "KeyU");

    expect(onChange).not.toHaveBeenCalled();
  });
});
