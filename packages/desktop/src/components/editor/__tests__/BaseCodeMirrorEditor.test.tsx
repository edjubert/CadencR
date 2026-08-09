import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@/test-utils";
import { createRef } from "react";
import { tooltips } from "@codemirror/view";
import BaseCodeMirrorEditor from "../BaseCodeMirrorEditor";

const mockDispatch = vi.fn();
const mockDestroy = vi.fn();
const mockFocus = vi.fn();
const mockDomEventHandlers = vi.fn((handlers: unknown) => ({ __handlers: handlers }));
const mockSendNeovimKeyInput = vi.fn();
const mockSubscribeToNeovimEvents = vi.fn();

vi.mock("@codemirror/view", () => {
  class MockEditorView {
    static updateListener = { of: vi.fn(() => []) };
    static domEventHandlers = mockDomEventHandlers;
    parent: HTMLElement | null = null;
    dispatch = mockDispatch;
    destroy = mockDestroy;
    focus = mockFocus;
    state = {
      doc: {
        toString: () => "",
        length: 0,
        lines: 5,
        line: (n: number) => ({ from: (n - 1) * 10, to: (n - 1) * 10 + 9 }),
      },
      selection: { main: { head: 0 } },
    };
    constructor({ parent }: { parent: HTMLElement }) {
      this.parent = parent;
    }
  }
  return {
    EditorView: MockEditorView,
    lineNumbers: vi.fn(() => []),
    highlightActiveLine: vi.fn(() => []),
    drawSelection: vi.fn(() => []),
    keymap: { of: vi.fn(() => []) },
    tooltips: vi.fn(() => []),
  };
});

vi.mock("@codemirror/state", () => {
  class MockCompartment {
    of() {
      return [];
    }
    reconfigure() {
      return [];
    }
  }
  return {
    EditorState: {
      create: vi.fn(() => ({})),
      readOnly: { of: vi.fn(() => []) },
      allowMultipleSelections: { of: vi.fn(() => []) },
    },
    Compartment: MockCompartment,
  };
});

vi.mock("@codemirror/commands", () => ({
  defaultKeymap: [],
  history: vi.fn(() => []),
  historyKeymap: [],
}));

vi.mock("@codemirror/language", () => ({
  bracketMatching: vi.fn(() => []),
  indentOnInput: vi.fn(() => []),
}));

vi.mock("@replit/codemirror-vim", () => ({
  vim: vi.fn(() => []),
}));

vi.mock("../editor-theme", () => ({
  cadencrEditorTheme: [],
}));

vi.mock("@/lib/editor/ergonomics-extensions", () => ({
  ergonomicsExtensions: [],
}));

vi.mock("../neovim-ws-send", () => ({
  sendNeovimKeyInput: mockSendNeovimKeyInput,
}));

vi.mock("@/stores/ws-neovim-store", () => ({
  subscribeToNeovimEvents: mockSubscribeToNeovimEvents,
}));

beforeEach(() => {
  mockDispatch.mockClear();
  mockDestroy.mockClear();
  mockFocus.mockClear();
  mockDomEventHandlers.mockClear();
  mockSendNeovimKeyInput.mockClear();
  mockSubscribeToNeovimEvents.mockReset().mockReturnValue(vi.fn());
  vi.mocked(tooltips).mockClear();
});

describe("BaseCodeMirrorEditor", () => {
  it("renders a container div with the given className", () => {
    const { container } = render(<BaseCodeMirrorEditor className="my-editor" />);
    expect(container.querySelector(".my-editor")).toBeInTheDocument();
  });

  it("uses default className when none provided", () => {
    const { container } = render(<BaseCodeMirrorEditor />);
    expect(container.querySelector(".h-full.overflow-auto")).toBeInTheDocument();
  });

  it("exposes EditorView via editorViewRef", () => {
    const ref = createRef<unknown>();
    render(<BaseCodeMirrorEditor editorViewRef={ref as React.MutableRefObject<null>} />);
    expect(ref.current).not.toBeNull();
    expect(ref.current).toHaveProperty("dispatch");
    expect(ref.current).toHaveProperty("focus");
  });

  it("cleans up EditorView on unmount", () => {
    const { unmount } = render(<BaseCodeMirrorEditor />);
    unmount();
    expect(mockDestroy).toHaveBeenCalledOnce();
  });

  it("nulls editorViewRef on unmount", () => {
    const ref = createRef<unknown>();
    const { unmount } = render(
      <BaseCodeMirrorEditor editorViewRef={ref as React.MutableRefObject<null>} />,
    );
    expect(ref.current).not.toBeNull();
    unmount();
    expect(ref.current).toBeNull();
  });

  it("notifies when EditorView mounts and unmounts", () => {
    const onEditorViewChange = vi.fn();
    const { unmount } = render(<BaseCodeMirrorEditor onEditorViewChange={onEditorViewChange} />);

    expect(onEditorViewChange).toHaveBeenCalledWith(expect.objectContaining({ focus: mockFocus }));
    unmount();
    expect(onEditorViewChange).toHaveBeenLastCalledWith(null);
  });

  // Regression: in the Frost themes the editor split pane carries its own
  // `backdrop-filter` and becomes a backdrop root, so a tooltip nested inside
  // `.cm-editor` cannot paint its own blur (the LSP symbol-info popover rendered
  // unblurred). Portaling the tooltips to `document.body` lifts them out of the
  // blurred pane so they can frost like every other overlay.
  it("portals CodeMirror tooltips to document.body so Frost blur can paint", () => {
    render(<BaseCodeMirrorEditor />);
    expect(tooltips).toHaveBeenCalledWith({ parent: document.body });
  });

  it("dispatches reconfigure when vimMode changes", () => {
    const { rerender } = render(<BaseCodeMirrorEditor vimMode={false} />);
    mockDispatch.mockClear();
    rerender(<BaseCodeMirrorEditor vimMode={true} />);
    expect(mockDispatch).toHaveBeenCalled();
  });

  it("dispatches reconfigure when readOnly changes", () => {
    const { rerender } = render(<BaseCodeMirrorEditor readOnly={false} />);
    mockDispatch.mockClear();
    rerender(<BaseCodeMirrorEditor readOnly={true} />);
    expect(mockDispatch).toHaveBeenCalled();
  });

  describe("neovimCompartment", () => {
    it("forwards keydown as key_input over WS when neovim-integrated is active", () => {
      render(
        <BaseCodeMirrorEditor
          isNeovimIntegrated={true}
          neovimFeatureId="7"
          neovimFilePath="src/main.rs"
        />,
      );

      expect(mockDomEventHandlers).toHaveBeenCalled();
      const handlers = mockDomEventHandlers.mock.calls[0][0] as {
        keydown: (event: { key: string; preventDefault: () => void }) => boolean;
      };
      const preventDefault = vi.fn();
      const handled = handlers.keydown({ key: "j", preventDefault });

      expect(mockSendNeovimKeyInput).toHaveBeenCalledWith("7", "src/main.rs", "j");
      expect(preventDefault).toHaveBeenCalled();
      expect(handled).toBe(true);
    });

    it("does not register the keydown handler when not neovim-integrated", () => {
      render(<BaseCodeMirrorEditor isNeovimIntegrated={false} />);
      expect(mockDomEventHandlers).not.toHaveBeenCalled();
    });

    it("subscribes to neovim events for the active (feature, file) pair", () => {
      render(
        <BaseCodeMirrorEditor
          isNeovimIntegrated={true}
          neovimFeatureId="7"
          neovimFilePath="src/main.rs"
        />,
      );

      expect(mockSubscribeToNeovimEvents).toHaveBeenCalledWith(
        "7",
        "src/main.rs",
        expect.objectContaining({
          onCursorMoved: expect.any(Function),
          onModeChanged: expect.any(Function),
          onBufferLinesChanged: expect.any(Function),
        }),
      );
    });

    it("applies cursor_moved and buffer_lines_changed callbacks to the document via dispatch", () => {
      render(
        <BaseCodeMirrorEditor
          isNeovimIntegrated={true}
          neovimFeatureId="7"
          neovimFilePath="src/main.rs"
        />,
      );

      const handlers = mockSubscribeToNeovimEvents.mock.calls[0][2] as {
        onCursorMoved: (line: number, col: number) => void;
        onBufferLinesChanged: (firstline: number, lastline: number, lines: string[]) => void;
      };

      mockDispatch.mockClear();
      handlers.onCursorMoved(3, 0);
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          selection: expect.objectContaining({ anchor: expect.any(Number) }),
        }),
      );

      mockDispatch.mockClear();
      handlers.onBufferLinesChanged(1, 2, ["replaced line"]);
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          changes: expect.objectContaining({ insert: "replaced line" }),
        }),
      );
    });
  });
});
