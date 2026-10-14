import { describe, expect, it, vi } from "vitest";
import type { Session } from "electron";
import { clearDataForOrigin } from "./browser-site-data";

describe("clearDataForOrigin", () => {
  it("attempts independent cookie removals in parallel", async () => {
    let finishFirst: () => void = () => {
      throw new Error("First cookie removal did not start.");
    };
    const remove = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(undefined);
    const targetSession = {
      cookies: {
        get: vi.fn().mockResolvedValue([
          { name: "first", domain: "app.example.com", path: "/" },
          { name: "second", domain: ".example.com", path: "/account" },
        ]),
        remove,
      },
      clearData: vi.fn().mockResolvedValue(undefined),
    } as unknown as Session;

    const clearing = clearDataForOrigin(targetSession, "https://app.example.com");
    await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(2));
    finishFirst();
    await clearing;

    expect(targetSession.clearData).toHaveBeenCalledOnce();
  });
});
