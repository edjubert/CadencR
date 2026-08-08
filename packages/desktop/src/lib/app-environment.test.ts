import { describe, expect, it } from "vitest";

import { resolveAppEnvironment } from "./app-environment";

describe("resolveAppEnvironment", () => {
  it("shows dev for the vite dev server regardless of branch", () => {
    expect(resolveAppEnvironment({ branch: "v0.10.0", isDevServer: true })).toEqual({
      kind: "dev",
    });
    expect(resolveAppEnvironment({ branch: "main", isDevServer: true })).toEqual({ kind: "dev" });
  });

  it("shows the current version for a local build off a version branch", () => {
    expect(resolveAppEnvironment({ branch: "v0.10.0", isDevServer: false })).toEqual({
      kind: "version",
      version: "v0.10.0",
    });
    expect(resolveAppEnvironment({ branch: "v12.34.56\n", isDevServer: false })).toEqual({
      kind: "version",
      version: "v12.34.56",
    });
  });

  it("shows beta for a local build off main", () => {
    expect(resolveAppEnvironment({ branch: "main", isDevServer: false })).toEqual({ kind: "beta" });
  });

  it("shows beta when the branch is unknown, as in a detached release checkout", () => {
    expect(resolveAppEnvironment({ branch: "HEAD", isDevServer: false })).toEqual({ kind: "beta" });
    expect(resolveAppEnvironment({ branch: "", isDevServer: false })).toEqual({ kind: "beta" });
  });

  it("requires the complete version branch format", () => {
    for (const branch of ["v12", "v2-feature", "v0.foo", "feature/prepare-v0.10.0"]) {
      expect(resolveAppEnvironment({ branch, isDevServer: false })).toEqual({ kind: "beta" });
    }
  });
});
