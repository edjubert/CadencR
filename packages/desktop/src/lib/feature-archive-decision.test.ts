import { describe, expect, it } from "vitest";
import type { Feature } from "@/api/generated";
import {
  getFeatureArchiveAction,
  getPendingFeatureArchiveAction,
} from "./feature-archive-decision";

const feature = (status: Feature["status"] = "active"): Feature => ({
  id: 1,
  project_id: 1,
  title: "Conversation",
  type: "ws-session",
  status,
  created_at: "2026-01-01T00:00:00Z",
  is_pinned: false,
});

describe("feature archive decision", () => {
  it("deletes an isolated empty active conversation", () => {
    expect(getFeatureArchiveAction(feature(), true, false)).toBe("delete");
  });

  it("archives an empty conversation when it has any parent or descendant relation", () => {
    expect(getFeatureArchiveAction(feature(), true, true)).toBe("archive");
  });

  it("waits for both checks before deciding an empty active conversation", () => {
    expect(
      getPendingFeatureArchiveAction({
        feature: feature(),
        emptyResponse: { empty: true },
        isCheckingEmpty: false,
        hasEmptyCheckError: false,
        isCheckingRelations: true,
      }),
    ).toBeNull();
  });

  it("falls back to archive when relation lookup fails", () => {
    expect(
      getPendingFeatureArchiveAction({
        feature: feature(),
        emptyResponse: { empty: true },
        isCheckingEmpty: false,
        hasEmptyCheckError: false,
        hasRelationCheckError: true,
      }),
    ).toBe("archive");
  });
});
