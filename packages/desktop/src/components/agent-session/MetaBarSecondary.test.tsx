import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { PROVIDER_IDS } from "@/lib/providers";
import { MetaBarSecondary } from "./MetaBarSecondary";

describe("MetaBarSecondary profile info", () => {
  it("exposes the profile in Info before a narrow session has a runtime id", async () => {
    const user = userEvent.setup();
    render(
      <MetaBarSecondary
        showWorktreeChip={false}
        showAutoScrollChip={false}
        autoScrollEnabled={false}
        onToggleAutoScroll={vi.fn()}
        runtimeProvider={PROVIDER_IDS.CODEX_CLI}
        claudeProfile="profile-id"
        claudeProfiles={[{ name: "profile-id", label: "QA profile", env: {} }]}
        onClaudeProfileChange={vi.fn()}
        showProfileSelector
      />,
    );

    await user.click(screen.getByRole("button", { name: "Session info" }));

    expect(screen.getByRole("combobox", { name: "Profile" })).toHaveTextContent("QA profile");
    expect(screen.queryByText("Session ID")).not.toBeInTheDocument();
  });
});
