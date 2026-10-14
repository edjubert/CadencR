import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { fireEvent, render } from "@/test-utils";
import { FeatureLayoutProvider } from "@/components/feature-layout/FeatureLayoutContext";
import { useFeatureLayoutStore } from "@/stores/feature-layout-store";
import { ROOT_LEAF_ID, type TabKind } from "@/stores/feature-layout-schema";
import type { GitNavigationAdapter } from "./gitNavigation";
import { useGitKeyboardController } from "./useGitKeyboardController";

const FEATURE_ID = 73;

function adapterMocks(): GitNavigationAdapter {
  return {
    getActiveItem: vi.fn(() => "active"),
    moveSelection: vi.fn(() => true),
    open: vi.fn(() => true),
    back: vi.fn(() => true),
    toggleViewed: vi.fn(() => true),
    stage: vi.fn(() => true),
    reset: vi.fn(() => true),
    scrollHalfPage: vi.fn(() => true),
    openInEditor: vi.fn(() => true),
  };
}

function Harness({
  adapter,
  enabled = true,
}: {
  adapter: GitNavigationAdapter;
  enabled?: boolean;
}) {
  const register = useGitKeyboardController(enabled);
  useEffect(() => register(adapter), [adapter, register]);
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
          tabIds: ["git", "terminal"],
          activeTabId: activeTab,
        },
        focusedPaneId: ROOT_LEAF_ID,
        appliedLayoutId: null,
      },
    },
  }));
}

function dispatchKey(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(event);
  return event;
}

beforeEach(() => seedLayout("git"));

afterEach(() => {
  useFeatureLayoutStore.setState((state) => {
    const features = { ...state.features };
    delete features[FEATURE_ID];
    return { ...state, features };
  });
  document.getSelection()?.removeAllRanges();
  document.querySelectorAll("[data-test-overlay]").forEach((element) => element.remove());
});

describe("useGitKeyboardController", () => {
  it.each([
    ["j", "moveSelection", [1]],
    ["k", "moveSelection", [-1]],
    ["l", "open", []],
    ["h", "back", []],
    ["v", "toggleViewed", []],
    ["s", "stage", []],
    ["r", "reset", []],
    ["d", "scrollHalfPage", [1]],
    ["u", "scrollHalfPage", [-1]],
  ] as const)("maps bare %s to %s", (key, command, args) => {
    const adapter = adapterMocks();
    render(<Harness adapter={adapter} />);

    const event = dispatchKey({ key, code: `Key${key.toUpperCase()}` });

    expect(adapter[command]).toHaveBeenCalledWith(...args);
    expect(event.defaultPrevented).toBe(true);
  });

  it("retains Mod+O for opening the selected file in Editor", () => {
    const adapter = adapterMocks();
    render(<Harness adapter={adapter} />);

    dispatchKey({ key: "o", code: "KeyO", metaKey: true });

    expect(adapter.openInEditor).toHaveBeenCalledOnce();
  });

  it("replaces rather than retains the old Ctrl+J/K/L/H/D/U defaults", () => {
    const adapter = adapterMocks();
    render(<Harness adapter={adapter} />);

    for (const key of ["j", "k", "l", "h", "d", "u"]) {
      dispatchKey({ key, code: `Key${key.toUpperCase()}`, ctrlKey: true });
    }

    expect(adapter.moveSelection).not.toHaveBeenCalled();
    expect(adapter.open).not.toHaveBeenCalled();
    expect(adapter.back).not.toHaveBeenCalled();
    expect(adapter.scrollHalfPage).not.toHaveBeenCalled();
  });

  it("matches the produced character rather than the physical QWERTY key", () => {
    const adapter = adapterMocks();
    render(<Harness adapter={adapter} />);

    dispatchKey({ key: "j", code: "KeyH" });
    dispatchKey({ key: "q", code: "KeyJ" });

    expect(adapter.moveSelection).toHaveBeenCalledOnce();
    expect(adapter.moveSelection).toHaveBeenCalledWith(1);
  });

  it("fires only while the Git tab owns the focused pane", () => {
    const adapter = adapterMocks();
    seedLayout("terminal");
    render(
      <FeatureLayoutProvider featureId={FEATURE_ID}>
        <Harness adapter={adapter} />
      </FeatureLayoutProvider>,
    );

    dispatchKey({ key: "j", code: "KeyJ" });

    expect(adapter.moveSelection).not.toHaveBeenCalled();
  });

  it.each([
    ["input", <input key="input" data-testid="guarded" />],
    ["textarea", <textarea key="textarea" data-testid="guarded" />],
    ["select", <select key="select" data-testid="guarded" />],
    ["contenteditable", <div key="editable" data-testid="guarded" contentEditable />],
    [
      "CodeMirror",
      <div key="codemirror" data-testid="guarded" className="cm-editor" tabIndex={0} />,
    ],
    [
      "editor focus zone",
      <div key="editor" data-testid="guarded" data-focus-zone="editor" tabIndex={0} />,
    ],
  ])("defers bare keys while %s owns focus", (_label, guarded) => {
    const adapter = adapterMocks();
    const { getByTestId } = render(
      <>
        <Harness adapter={adapter} />
        {guarded}
      </>,
    );
    getByTestId("guarded").focus();

    fireEvent.keyDown(getByTestId("guarded"), { key: "j", code: "KeyJ" });

    expect(adapter.moveSelection).not.toHaveBeenCalled();
  });

  it("defers to Pierre search focused inside a shadow root", () => {
    const adapter = adapterMocks();
    render(<Harness adapter={adapter} />);
    const host = document.createElement("div");
    host.dataset.testOverlay = "shadow";
    const shadow = host.attachShadow({ mode: "open" });
    const search = document.createElement("input");
    search.setAttribute("aria-label", "Search files");
    shadow.append(search);
    document.body.append(host);
    search.focus();

    search.dispatchEvent(
      new KeyboardEvent("keydown", { key: "j", code: "KeyJ", bubbles: true, composed: true }),
    );

    expect(adapter.moveSelection).not.toHaveBeenCalled();
  });

  it("defers during IME composition and active text selection", () => {
    const adapter = adapterMocks();
    const { getByTestId } = render(
      <>
        <Harness adapter={adapter} />
        <p data-testid="selection">selected text</p>
      </>,
    );

    dispatchKey({ key: "Process", code: "KeyJ", isComposing: true });
    const selection = document.getSelection();
    const range = document.createRange();
    range.selectNodeContents(getByTestId("selection"));
    selection?.removeAllRanges();
    selection?.addRange(range);
    dispatchKey({ key: "j", code: "KeyJ" });

    expect(adapter.moveSelection).not.toHaveBeenCalled();
  });

  it("keeps chords live while a selection holds the bare keys back", () => {
    const adapter = adapterMocks();
    const { getByTestId } = render(
      <>
        <Harness adapter={adapter} />
        <p data-testid="selection">selected text</p>
      </>,
    );
    const range = document.createRange();
    range.selectNodeContents(getByTestId("selection"));
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    // `j` stays deferred — a bare letter next to a highlighted range reads as a
    // selection gesture. ⌘O cannot, so the selection has no claim on it.
    dispatchKey({ key: "j", code: "KeyJ" });
    dispatchKey({ key: "o", code: "KeyO", metaKey: true });

    expect(adapter.moveSelection).not.toHaveBeenCalled();
    expect(adapter.openInEditor).toHaveBeenCalledOnce();
  });

  it("lets an open dialog own bare u before the Git scroll command", () => {
    const adapter = adapterMocks();
    render(<Harness adapter={adapter} />);
    const dialog = document.createElement("div");
    dialog.dataset.testOverlay = "dialog";
    dialog.dataset.slot = "dialog-content";
    dialog.dataset.state = "open";
    dialog.setAttribute("role", "dialog");
    const toggle = document.createElement("button");
    dialog.append(toggle);
    document.body.append(dialog);
    const dialogOwner = vi.fn();
    toggle.addEventListener("keydown", dialogOwner);

    fireEvent.keyDown(toggle, { key: "u", code: "KeyU" });

    expect(dialogOwner).toHaveBeenCalledOnce();
    expect(adapter.scrollHalfPage).not.toHaveBeenCalled();
  });

  it.each([
    ["popover", "popover-content", null],
    ["dropdown menu", "dropdown-menu-content", "menu"],
    ["context menu", "context-menu-content", "menu"],
    ["select menu", "select-content", "listbox"],
  ])("defers while an open %s owns commands", (_label, slot, role) => {
    const adapter = adapterMocks();
    render(<Harness adapter={adapter} />);
    const overlay = document.createElement("div");
    overlay.dataset.testOverlay = slot;
    overlay.dataset.slot = slot;
    overlay.dataset.state = "open";
    if (role) overlay.setAttribute("role", role);
    document.body.append(overlay);

    dispatchKey({ key: "j", code: "KeyJ" });

    expect(adapter.moveSelection).not.toHaveBeenCalled();
  });

  it("does not let a closed overlay suppress Git navigation", () => {
    const adapter = adapterMocks();
    render(<Harness adapter={adapter} />);
    const dialog = document.createElement("div");
    dialog.dataset.testOverlay = "closed-dialog";
    dialog.dataset.slot = "dialog-content";
    dialog.dataset.state = "closed";
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);

    dispatchKey({ key: "j", code: "KeyJ" });

    expect(adapter.moveSelection).toHaveBeenCalledOnce();
  });

  it("allows repeat only for movement and half-page scrolling", () => {
    const adapter = adapterMocks();
    render(<Harness adapter={adapter} />);

    dispatchKey({ key: "j", code: "KeyJ", repeat: true });
    dispatchKey({ key: "d", code: "KeyD", repeat: true });
    dispatchKey({ key: "s", code: "KeyS", repeat: true });
    dispatchKey({ key: "r", code: "KeyR", repeat: true });

    expect(adapter.moveSelection).toHaveBeenCalledOnce();
    expect(adapter.scrollHalfPage).toHaveBeenCalledOnce();
    expect(adapter.stage).not.toHaveBeenCalled();
    expect(adapter.reset).not.toHaveBeenCalled();
  });
});
