import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { desktopBridge } from "@/lib/desktop-bridge";
import {
  CreateProviderWorkspaceDialog,
  providerDirectoryError,
  providerIdError,
} from "./CreateProviderWorkspaceDialog";

vi.mock("@/lib/desktop-bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/desktop-bridge")>()),
  desktopBridge: { isElectron: true, pickDirectory: vi.fn() },
}));

const pickDirectory = vi.mocked(desktopBridge.pickDirectory);

describe("CreateProviderWorkspaceDialog", () => {
  beforeEach(() => {
    pickDirectory.mockReset();
  });

  it("derives an editable registry id and submits the connector identity", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(
      <CreateProviderWorkspaceDialog isCreating={false} onCreate={onCreate} onClose={vi.fn()} />,
    );

    const submit = screen.getByRole("button", { name: "Create provider project" });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText("Display name"), "Pi Connector");
    expect(screen.getByLabelText("Provider ID")).toHaveValue("pi-connector");
    await user.click(submit);

    expect(onCreate).toHaveBeenCalledWith({
      providerId: "pi-connector",
      displayName: "Pi Connector",
    });
  });

  it("keeps a manually edited id and exposes creation progress", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    const { rerender } = render(
      <CreateProviderWorkspaceDialog isCreating={false} onCreate={onCreate} onClose={vi.fn()} />,
    );

    await user.type(screen.getByLabelText("Display name"), "Pi");
    await user.clear(screen.getByLabelText("Provider ID"));
    await user.type(screen.getByLabelText("Provider ID"), "pi-coding-agent");
    await user.type(screen.getByLabelText("Display name"), " Agent");
    expect(screen.getByLabelText("Provider ID")).toHaveValue("pi-coding-agent");

    rerender(<CreateProviderWorkspaceDialog isCreating onCreate={onCreate} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Creating project…" })).toBeDisabled();
    expect(
      screen.getByText("Creating the provider project and opening its conversation."),
    ).toBeInTheDocument();
  });

  it("selects and imports an existing connector folder", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    pickDirectory.mockResolvedValue("/code/pi-connector");
    render(
      <CreateProviderWorkspaceDialog isCreating={false} onCreate={onCreate} onClose={vi.fn()} />,
    );

    await user.click(screen.getByRole("radio", { name: /From existing folder/ }));
    await user.click(screen.getByRole("button", { name: "Browse…" }));
    expect(screen.getByLabelText("Connector folder")).toHaveValue("/code/pi-connector");
    await user.type(screen.getByLabelText("Display name"), "Pi Connector");
    await user.click(screen.getByRole("button", { name: "Import provider project" }));

    expect(onCreate).toHaveBeenCalledWith({
      providerId: "pi-connector",
      displayName: "Pi Connector",
      directory: "/code/pi-connector",
    });
  });

  it("keeps manual entry available and preserves it when folder selection is canceled", async () => {
    const user = userEvent.setup();
    pickDirectory.mockResolvedValue(null);
    render(
      <CreateProviderWorkspaceDialog isCreating={false} onCreate={vi.fn()} onClose={vi.fn()} />,
    );

    await user.click(screen.getByRole("radio", { name: /From existing folder/ }));
    await user.type(screen.getByLabelText("Connector folder"), "C:\\code\\pi");
    await user.click(screen.getByRole("button", { name: "Browse…" }));

    expect(screen.getByLabelText("Connector folder")).toHaveValue("C:\\code\\pi");
  });

  it("surfaces picker failure and lets the user recover with a manual path", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    pickDirectory.mockRejectedValue(new Error("native picker unavailable"));
    render(
      <CreateProviderWorkspaceDialog isCreating={false} onCreate={onCreate} onClose={vi.fn()} />,
    );
    await user.click(screen.getByRole("radio", { name: /From existing folder/ }));
    await user.click(screen.getByRole("button", { name: "Browse…" }));
    expect(screen.getByText(/Could not open the folder picker/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Display name"), "Manual Provider");
    await user.type(screen.getByLabelText("Connector folder"), "/code/manual");
    expect(screen.queryByText(/Could not open the folder picker/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Import provider project" }));
    expect(onCreate).toHaveBeenCalledWith({
      providerId: "manual-provider",
      displayName: "Manual Provider",
      directory: "/code/manual",
    });
  });

  it("drops the import directory when switching back to scaffold creation", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(
      <CreateProviderWorkspaceDialog isCreating={false} onCreate={onCreate} onClose={vi.fn()} />,
    );
    await user.type(screen.getByLabelText("Display name"), "New Provider");
    await user.click(screen.getByRole("radio", { name: /From existing folder/ }));
    await user.type(screen.getByLabelText("Connector folder"), "/code/unused");
    await user.click(screen.getByRole("radio", { name: /Create new/ }));
    await user.click(screen.getByRole("button", { name: "Create provider project" }));
    expect(onCreate).toHaveBeenCalledWith({
      providerId: "new-provider",
      displayName: "New Provider",
    });
  });

  it("requires an absolute path for an existing connector", async () => {
    const user = userEvent.setup();
    render(
      <CreateProviderWorkspaceDialog isCreating={false} onCreate={vi.fn()} onClose={vi.fn()} />,
    );

    await user.click(screen.getByRole("radio", { name: /From existing folder/ }));
    await user.type(screen.getByLabelText("Display name"), "Pi");
    await user.type(screen.getByLabelText("Connector folder"), "relative/provider");

    expect(screen.getByText("Enter an absolute folder path.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import provider project" })).toBeDisabled();
  });

  it("blocks submit and close while folder selection is pending", async () => {
    const user = userEvent.setup();
    let resolvePicker: (path: string | null) => void = () => undefined;
    pickDirectory.mockReturnValue(
      new Promise((resolve) => {
        resolvePicker = resolve;
      }),
    );
    const onCreate = vi.fn();
    const onClose = vi.fn();
    render(
      <CreateProviderWorkspaceDialog isCreating={false} onCreate={onCreate} onClose={onClose} />,
    );

    await user.click(screen.getByRole("radio", { name: /From existing folder/ }));
    await user.type(screen.getByLabelText("Display name"), "Pi");
    await user.type(screen.getByLabelText("Connector folder"), "/old/provider");
    await user.click(screen.getByRole("button", { name: "Browse…" }));

    expect(screen.getByRole("button", { name: "Import provider project" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(onCreate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    resolvePicker("/new/provider");
    expect(await screen.findByDisplayValue("/new/provider")).toBeInTheDocument();
  });
});

describe("providerIdError", () => {
  it("matches the backend registry id shape", () => {
    expect(providerIdError("pi-connector")).toBeNull();
    expect(providerIdError("Pi Connector")).toMatch(/lowercase/i);
    expect(providerIdError("2pi")).toMatch(/start with a letter/i);
  });
});

describe("providerDirectoryError", () => {
  it("accepts POSIX, drive-letter, and UNC absolute paths", () => {
    expect(providerDirectoryError("/code/provider")).toBeNull();
    expect(providerDirectoryError("C:\\code\\provider")).toBeNull();
    expect(providerDirectoryError("\\\\server\\providers\\pi")).toBeNull();
    expect(providerDirectoryError("providers/pi")).toMatch(/absolute/i);
  });
});
