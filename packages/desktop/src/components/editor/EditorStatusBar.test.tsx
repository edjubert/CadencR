import { expect, it, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { EditorStatusBar } from "./EditorStatusBar";

vi.mock("./LspStatusIndicator", () => ({ LspStatusIndicator: () => null }));
vi.mock("@/lib/browser-suppression", () => ({ useSuppressBrowserView: vi.fn() }));

it("shows formatting progress until formatting ends, then save progress", () => {
  const props = {
    line: 1,
    col: 1,
    language: "Text",
    autoSavedVisible: true,
    lspStatus: "unsupported" as const,
    lspLanguageId: null,
    diskSync: {
      diskChanged: false,
      isSaving: true,
      errorMessage: null,
      reloadFromDisk: vi.fn(),
      overwriteDisk: vi.fn(),
    },
  };
  const { rerender } = render(<EditorStatusBar {...props} isFormatting />);
  expect(screen.getByRole("status")).toHaveTextContent("Formatting…");
  expect(screen.queryByText("Auto-saved")).not.toBeInTheDocument();
  rerender(<EditorStatusBar {...props} isFormatting={false} />);
  expect(screen.getByRole("status")).toHaveTextContent("Saving…");
  rerender(<EditorStatusBar {...props} diskSync={{ ...props.diskSync, isSaving: false }} />);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByText("Auto-saved")).toBeInTheDocument();
});
