import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { buildRepairPlan, identifyMisroutes } from "./codex-conversation-repair.mjs";

function evidence() {
  return {
    root: {
      path: "root.jsonl",
      metadata: { id: "root" },
      activities: [{ kind: "started", sender: "root", target: "child", callId: "spawn", line: 10 }],
    },
    children: [
      {
        path: "child.jsonl",
        metadata: {
          id: "child",
          source: { subagent: { thread_spawn: { parent_thread_id: "root" } } },
        },
        activities: [
          {
            kind: "interacted",
            sender: "child",
            target: "root",
            callId: "send",
            line: 12,
            timestamp: "2026-09-14T19:48:31Z",
          },
        ],
      },
    ],
  };
}

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE agent_sessions(id INTEGER, runtime_provider TEXT, runtime_session_id TEXT);
    CREATE TABLE agent_messages(id INTEGER, session_id INTEGER, message_type TEXT, tool_name TEXT,
      tool_use_id TEXT, parent_tool_use_id TEXT, created_at TEXT, content TEXT);
    INSERT INTO agent_sessions VALUES (1, 'codex_cli', 'root');
    INSERT INTO agent_messages VALUES
      (1,1,'tool_call','Agent','spawn',NULL,'2026-09-14 19:48:24','{}'),
      (2,1,'tool_call','collaboration__send_message','send','spawn','2026-09-14 19:48:31','{}'),
      (3,1,'text',NULL,NULL,'send','2026-09-14 19:48:35','root answer'),
      (4,1,'text',NULL,NULL,'spawn','2026-09-14 19:48:36','real child answer'),
      (5,2,'text',NULL,NULL,'send','2026-09-14 19:48:37','unrelated session');`);
  db.exec("PRAGMA query_only=ON");
  return db;
}

test("dry-run changes only proven root misroutes, preserving children and other sessions", () => {
  const db = database();
  try {
    const before = db.prepare("SELECT * FROM agent_messages").all();
    const args = { sessionId: 1, throughMessageId: 5, ...evidence() };
    const plan = buildRepairPlan(db, args);
    assert.equal(plan.mode, "dry-run-only");
    assert.equal(plan.scannedRows, 4);
    assert.equal(plan.changedRows, 1);
    assert.deepEqual(plan.byType, { text: 1 });
    assert.equal(plan.changes[0].id, 3);
    assert.equal(plan.changes[0].expectedParent, "send");
    assert.equal(plan.changes[0].proposedParent, null);
    assert.equal(plan.changes[0].contentSha256.length, 64);
    assert.deepEqual(db.prepare("SELECT * FROM agent_messages").all(), before);
    assert.deepEqual(buildRepairPlan(db, args), plan);
    assert.equal(buildRepairPlan(db, { ...args, throughMessageId: 2 }).changedRows, 0);
  } finally {
    db.close();
  }
});

test("rejects mismatched runtime identity and unproven ancestry", () => {
  const db = database();
  try {
    const data = evidence();
    data.root.metadata.id = "other-root";
    assert.throws(
      () => buildRepairPlan(db, { sessionId: 1, throughMessageId: 5, ...data }),
      /Root does not match/,
    );
    assert.throws(() => identifyMisroutes(data.root, data.children), /proven direct children/);
    const missing = evidence();
    missing.root.activities = [];
    assert.throws(
      () => identifyMisroutes(missing.root, missing.children),
      /No root spawn evidence/,
    );
  } finally {
    db.close();
  }
});

test("does not confuse sibling messaging with a corrupted root route", () => {
  const { root, children } = evidence();
  children[0].activities[0].target = "sibling";
  assert.deepEqual(identifyMisroutes(root, children), []);
});

test("refuses ambiguous DB anchors and requires a bounded cutoff", () => {
  const db = database();
  try {
    const args = { sessionId: 1, throughMessageId: 5, ...evidence() };
    assert.throws(() => buildRepairPlan(db, { ...args, throughMessageId: undefined }), /cutoff/);
    db.exec(
      "PRAGMA query_only=OFF; UPDATE agent_messages SET parent_tool_use_id = 'other-spawn' WHERE id = 2; PRAGMA query_only=ON",
    );
    assert.throws(() => buildRepairPlan(db, args), /wrong child parent/);
  } finally {
    db.close();
  }
});

test("reads content only for candidates, never unrelated large payloads or an empty plan", () => {
  const db = database();
  try {
    db.exec("PRAGMA query_only=OFF");
    db.prepare("UPDATE agent_messages SET content = ? WHERE id = 4").run(
      "x".repeat(4 * 1024 * 1024),
    );
    db.exec("PRAGMA query_only=ON");
    const contentIds = [];
    const traced = {
      prepare(sql) {
        const statement = db.prepare(sql);
        if (!sql.includes("content")) return statement;
        assert.equal(sql, "SELECT content FROM agent_messages WHERE id = ? AND session_id = ?");
        return {
          get(id, session) {
            contentIds.push(id);
            return statement.get(id, session);
          },
        };
      },
    };
    const args = { sessionId: 1, throughMessageId: 5, ...evidence() };
    assert.equal(buildRepairPlan(traced, args).changedRows, 1);
    assert.deepEqual(contentIds, [3]);
    contentIds.length = 0;
    args.children[0].activities = [];
    const empty = buildRepairPlan(traced, args);
    assert.equal(empty.scannedRows, 4);
    assert.equal(empty.changedRows, 0);
    assert.deepEqual(contentIds, []);
  } finally {
    db.close();
  }
});

test("duplicate spawn anchors are rejected rather than choosing the first row", () => {
  const db = database();
  try {
    db.exec(
      "PRAGMA query_only=OFF; INSERT INTO agent_messages SELECT 6,session_id,message_type,tool_name,tool_use_id,parent_tool_use_id,created_at,content FROM agent_messages WHERE id=1; PRAGMA query_only=ON",
    );
    assert.throws(
      () => buildRepairPlan(db, { sessionId: 1, throughMessageId: 6, ...evidence() }),
      /Ambiguous child spawn/,
    );
  } finally {
    db.close();
  }
});
