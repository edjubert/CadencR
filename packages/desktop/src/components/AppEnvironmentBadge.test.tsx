import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppEnvironmentBadge } from "./AppEnvironmentBadge";

describe("AppEnvironmentBadge", () => {
  it("renders the beta badge with theme-aware contrast classes", () => {
    render(<AppEnvironmentBadge environment={{ kind: "beta" }} />);

    expect(screen.getByText("beta")).toHaveClass("bg-primary/15", "text-primary");
  });

  it("renders the dev badge with the existing orange tone", () => {
    render(<AppEnvironmentBadge environment={{ kind: "dev" }} />);

    expect(screen.getByText("dev")).toHaveClass("bg-orange-500/20", "text-orange-400");
  });

  it("renders the version badge with its dynamic label and theme-owned purple accent", () => {
    render(<AppEnvironmentBadge environment={{ kind: "version", version: "v0.10.0" }} />);

    expect(screen.getByText("v0.10.0")).toHaveClass(
      "bg-[color-mix(in_oklab,var(--acc-purple)_15%,transparent)]",
      "text-[var(--acc-purple)]",
    );
  });
});
