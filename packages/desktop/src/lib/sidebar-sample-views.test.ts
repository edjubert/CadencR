import { describe, expect, it } from "vitest";
import { buildSampleConversations } from "@/lib/sidebar-sample-data";
import { sampleViews, type SampleRow } from "@/lib/sidebar-sample-views";

const rows: SampleRow[] = buildSampleConversations(Date.UTC(2026, 9, 11)).map((conversation) => ({
  conversation,
  state: conversation.state,
}));
const titles = (list: readonly SampleRow[]) => list.map((row) => row.conversation.feature.title);

describe("sampleViews", () => {
  it("lists what needs an action first, then replies to read, oldest first", () => {
    expect(titles(sampleViews(rows, 5).forMe)).toEqual([
      "Tokenize the spacing scale",
      "Fix flaky checkout test",
      "Migrate billing webhooks",
      "Write the 2.4 release notes",
      "Audit the color tokens",
    ]);
  });

  it("keeps the chosen number of recent conversations, newest first", () => {
    expect(titles(sampleViews(rows, 3).recent)).toEqual([
      "Add a dark mode toggle",
      "Fix flaky checkout test",
      "Upgrade Storybook",
    ]);
  });

  it("counts each project's states for its badges and rail tile", () => {
    expect(sampleViews(rows, 5).attention.byProject.get(-3)).toEqual({
      waiting: 1,
      failed: 0,
      working: 1,
      unread: 0,
    });
  });

  it("orders the rail like the live attention index, and queues only what needs the user", () => {
    const { items, queue } = sampleViews(rows, 5).attention;
    expect(items.map((item) => item.state)).toEqual([
      "waiting",
      "waiting",
      "failed",
      "working",
      "working",
      "unread",
      "unread",
    ]);
    expect(queue.map((item) => item.state)).toEqual([
      "waiting",
      "waiting",
      "failed",
      "unread",
      "unread",
    ]);
  });
});
