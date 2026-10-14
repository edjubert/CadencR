import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { toast } from "sonner";
import { CodexProfilesSection } from "./CodexProfilesSection";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  activate: { mutate: vi.fn(), isPending: false },
  remove: { mutateAsync: vi.fn(), isPending: false },
}));

vi.mock("@/api/codexProfiles", () => ({
  useCodexProfiles: () => mocks.query(),
  useSetActiveCodexProfile: () => mocks.activate,
  useDeleteCodexProfile: () => mocks.remove,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const profile = {
  id: "profile-id",
  name: "Work account",
  config_path: "/tmp/work/config.toml",
  effective_home: "/tmp/work",
  env_keys: ["OPENAI_API_KEY"],
  env_unset: ["CODEX_API_KEY"],
  is_active: false,
  revision: "rev-1",
};

describe("CodexProfilesSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activate.isPending = false;
    mocks.remove.isPending = false;
    mocks.query.mockReturnValue({
      data: { active_profile_id: null, profiles: [profile] },
      isLoading: false,
      isError: false,
    });
  });

  it("matches the built-in and active profile hierarchy", () => {
    render(<CodexProfilesSection />);

    expect(screen.getByText("default")).toBeInTheDocument();
    expect(screen.getByText("Built-in")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activate" })).toBeInTheDocument();
    expect(screen.getByText("1 env var · 1 removed inherited variable")).toBeInTheDocument();
    expect(screen.getByText("Work account").closest(".flex-wrap")).toHaveClass("gap-y-2");
    expect(screen.getByText("Work account").parentElement?.parentElement).toHaveClass(
      "flex-1",
      "basis-40",
      "min-w-0",
    );
  });

  it("activates a saved profile with visible pending feedback", async () => {
    const user = userEvent.setup();
    render(<CodexProfilesSection />);

    await user.click(screen.getByRole("button", { name: "Activate" }));

    expect(mocks.activate.mutate).toHaveBeenCalledWith("profile-id", expect.any(Object));
    expect(screen.getByRole("button", { name: "Activate" })).toHaveAttribute("aria-busy", "true");
  });

  it("restores the built-in profile and reflects the confirmed active response", async () => {
    const user = userEvent.setup();
    const activeProfile = { ...profile, is_active: true };
    mocks.query.mockReturnValue({
      data: { active_profile_id: profile.id, profiles: [activeProfile] },
      isLoading: false,
      isError: false,
    });
    const view = render(<CodexProfilesSection />);

    await user.click(screen.getByRole("button", { name: "Activate" }));
    expect(mocks.activate.mutate).toHaveBeenCalledWith(null, expect.any(Object));

    mocks.query.mockReturnValue({
      data: { active_profile_id: null, profiles: [{ ...profile, is_active: false }] },
      isLoading: false,
      isError: false,
    });
    view.rerender(<CodexProfilesSection />);

    expect(screen.getByText("default").parentElement).toHaveTextContent("Active");
    expect(screen.getByText("Work account").parentElement).not.toHaveTextContent("Active");
  });

  it("surfaces activation errors", async () => {
    const user = userEvent.setup();
    mocks.activate.mutate.mockImplementation((_id, options) => {
      options.onError(new Error("Profile could not be used"));
      options.onSettled();
    });
    render(<CodexProfilesSection />);

    await user.click(screen.getByRole("button", { name: "Activate" }));

    expect(toast.error).toHaveBeenCalledWith("Profile could not be used");
  });

  it("keeps the delete dialog open and shows a referenced-profile conflict", async () => {
    const user = userEvent.setup();
    mocks.remove.mutateAsync.mockRejectedValue(new Error("Profile is referenced by a schedule"));
    render(<CodexProfilesSection />);

    await user.click(screen.getByRole("button", { name: "Delete Work account" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(toast.error).toHaveBeenCalledWith("Profile is referenced by a schedule");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
