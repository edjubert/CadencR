import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BrowserSitePermissionStore } from "./browser-site-permission-store";

describe("BrowserSitePermissionStore", () => {
  it("persists Normal-profile decisions by partition, origin, and permission", () => {
    const filePath = `/tmp/cadencr-site-permissions-${randomUUID()}.json`;
    const first = new BrowserSitePermissionStore(filePath);
    first.set("persist:browser:default", "https://app.example.com", "camera", "allow");

    const reopened = new BrowserSitePermissionStore(filePath);
    expect(reopened.get("persist:browser:default", "https://app.example.com", "camera")).toBe(
      "allow",
    );
    expect(reopened.get("persist:browser:other", "https://app.example.com", "camera")).toBe("ask");
    expect(reopened.get("persist:browser:default", "https://other.test", "camera")).toBe("ask");
  });

  it("persists a combined permission decision as one batch", () => {
    const filePath = `/tmp/cadencr-site-permissions-${randomUUID()}.json`;
    const first = new BrowserSitePermissionStore(filePath);
    first.setMany("persist:browser:default", "https://app.example.com", [
      ["camera", "allow"],
      ["microphone", "allow"],
    ]);

    const reopened = new BrowserSitePermissionStore(filePath);
    expect(reopened.get("persist:browser:default", "https://app.example.com", "camera")).toBe(
      "allow",
    );
    expect(reopened.get("persist:browser:default", "https://app.example.com", "microphone")).toBe(
      "allow",
    );
  });
});
