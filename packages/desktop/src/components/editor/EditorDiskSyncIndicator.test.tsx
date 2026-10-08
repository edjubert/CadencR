import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { EditorDiskSyncIndicator, type EditorDiskSyncState } from "./EditorDiskSyncIndicator";

vi.mock("@/lib/browser-suppression", () => ({ useSuppressBrowserView: vi.fn() }));

function syncState(): EditorDiskSyncState {
  return {
    diskChanged: true,
    isSaving: false,
    errorMessage: null,
    reloadFromDisk: vi.fn(async () => {}),
    overwriteDisk: vi.fn(async () => {}),
  };
}

describe("disk-change status indicator", () => {
  it("opens a confirmation with a safe default and keeps editing without data changes", async () => {
    const sync = syncState();
    const { user } = render(<EditorDiskSyncIndicator sync={sync} />);
    const indicator = screen.getByRole("button", { name: "Disk changed" });
    expect(indicator).toHaveClass("text-[var(--acc-orange)]");
    await user.click(indicator);
    expect(screen.getByRole("dialog", { name: "File changed on disk" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep editing" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(sync.reloadFromDisk).not.toHaveBeenCalled();
    expect(sync.overwriteDisk).not.toHaveBeenCalled();
  });

  it("requires an explicit discard action to reload", async () => {
    const sync = syncState();
    const { user } = render(<EditorDiskSyncIndicator sync={sync} />);
    await user.click(screen.getByRole("button", { name: "Disk changed" }));
    expect(sync.reloadFromDisk).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Discard edits and reload" }));
    expect(sync.reloadFromDisk).toHaveBeenCalledOnce();
    expect(sync.overwriteDisk).not.toHaveBeenCalled();
  });

  it("shows progress and prevents overlapping destructive actions", async () => {
    const sync = syncState();
    const { user, rerender } = render(<EditorDiskSyncIndicator sync={sync} />);
    await user.click(screen.getByRole("button", { name: "Disk changed" }));
    rerender(<EditorDiskSyncIndicator sync={{ ...sync, isSaving: true }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Synchronizing");
    expect(screen.getByRole("button", { name: "Discard edits and reload" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Overwrite disk" })).toBeDisabled();
  });
});
