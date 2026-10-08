import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderDevelopmentCard } from "./ProviderDevelopmentCard";

const {
  mutate,
  navigate,
  queryClient,
  toastSuccess,
  toastError,
  navigateToFeatureIdOrHome,
  invalidateByExactUrl,
} = vi.hoisted(() => ({
  mutate: vi.fn(),
  navigate: vi.fn(),
  queryClient: {},
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  navigateToFeatureIdOrHome: vi.fn(),
  invalidateByExactUrl: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => queryClient }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("@/api/generated", () => ({
  useCreateProviderWorkspace: () => ({ mutate, isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { success: toastSuccess } }));
vi.mock("@/lib/api-errors", () => ({ toastError }));
vi.mock("@/lib/queryClient", () => ({ invalidateByExactUrl }));
vi.mock("@/components/project-feature-navigation", () => ({ navigateToFeatureIdOrHome }));
vi.mock("./CreateProviderWorkspaceDialog", () => ({
  CreateProviderWorkspaceDialog: ({
    onCreate,
  }: {
    onCreate: (draft: { providerId: string; displayName: string; directory?: string }) => void;
  }) => (
    <div>
      <button onClick={() => onCreate({ providerId: "new-provider", displayName: "New Provider" })}>
        Submit new
      </button>
      <button
        onClick={() =>
          onCreate({
            providerId: "imported-provider",
            displayName: "Imported Provider",
            directory: "/code/imported-provider",
          })
        }
      >
        Submit import
      </button>
    </div>
  ),
}));

type MutationCallbacks = {
  onSuccess: (workspace: { project_id: number; feature_id: number }) => void;
  onError: (error: unknown) => void;
};

async function openDialog(): Promise<void> {
  await userEvent.setup().click(screen.getByRole("button", { name: "Add provider" }));
}

describe("ProviderDevelopmentCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateByExactUrl.mockResolvedValue(undefined);
  });

  it("omits directory when creating a scaffold", async () => {
    render(<ProviderDevelopmentCard />);
    await openDialog();
    await userEvent.setup().click(screen.getByRole("button", { name: "Submit new" }));

    expect(mutate).toHaveBeenCalledWith(
      { data: { provider_id: "new-provider", display_name: "New Provider" } },
      expect.any(Object),
    );
  });

  it("propagates directory and handles imported project success", async () => {
    render(<ProviderDevelopmentCard />);
    await openDialog();
    await userEvent.setup().click(screen.getByRole("button", { name: "Submit import" }));

    expect(mutate).toHaveBeenCalledWith(
      {
        data: {
          provider_id: "imported-provider",
          display_name: "Imported Provider",
          directory: "/code/imported-provider",
        },
      },
      expect.any(Object),
    );
    const callbacks = mutate.mock.calls[0]?.[1] as MutationCallbacks;
    callbacks.onSuccess({ project_id: 12, feature_id: 34 });

    expect(toastSuccess).toHaveBeenCalledWith("Provider project imported", {
      description: "The trusted local connector is registered. Restart Cadencr to test it.",
    });
    expect(navigateToFeatureIdOrHome).toHaveBeenCalledWith(navigate, 12, 34);
    expect(invalidateByExactUrl).toHaveBeenCalledWith(queryClient, [
      "/api/projects",
      "/api/features",
    ]);
  });

  it("surfaces an import-specific mutation error", async () => {
    render(<ProviderDevelopmentCard />);
    await openDialog();
    await userEvent.setup().click(screen.getByRole("button", { name: "Submit import" }));
    const callbacks = mutate.mock.calls[0]?.[1] as MutationCallbacks;
    const error = new Error("not executable");
    callbacks.onError(error);

    expect(toastError).toHaveBeenCalledWith(error, "Failed to import the provider project");
  });
});
