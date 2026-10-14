#!/usr/bin/env node
// Read-only preparation, not an automatic migration or an apply command.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function readRollout(path) {
  const input = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  const activities = [];
  let metadata;
  let line = 0;
  try {
    for await (const text of lines) {
      line += 1;
      if (!text.trim()) continue;
      const event = JSON.parse(text);
      if (event.type === "session_meta") metadata = event.payload;
      const payload = event.payload;
      const item = payload?.item;
      if (event.type !== "event_msg" || payload?.type !== "item_completed") continue;
      if (!["SubAgentActivity", "subAgentActivity"].includes(item?.type)) continue;
      activities.push({
        line,
        timestamp: event.timestamp,
        sender: payload.thread_id ?? payload.threadId,
        target: item.agent_thread_id ?? item.agentThreadId,
        kind: item.kind,
        callId: item.id,
      });
    }
  } finally {
    lines.close();
    input.destroy();
  }
  assert.equal(typeof metadata?.id, "string", "Missing native session identity");
  return { path: resolve(path), metadata, activities };
}

export function identifyMisroutes(root, children) {
  const rootId = root.metadata.id;
  const misroutes = new Map();
  for (const child of children) {
    const source = child.metadata.source;
    const spawn = (source?.subagent ?? source?.subAgent)?.thread_spawn;
    assert.equal(spawn?.parent_thread_id, rootId, "Only proven direct children are eligible");
    const childId = child.metadata.id;
    const origin = root.activities.find(
      (event) => event.kind === "started" && event.sender === rootId && event.target === childId,
    );
    assert.ok(origin, `No root spawn evidence for ${childId}`);
    for (const event of child.activities) {
      if (event.kind !== "interacted" || event.target !== rootId) continue;
      assert.equal(event.sender, childId, "Interaction sender does not match native child");
      assert.equal(typeof event.callId, "string", "Interaction has no call identity");
      assert.ok(
        event.callId && Number.isFinite(Date.parse(event.timestamp)),
        "Invalid interaction",
      );
      const evidence = {
        callId: event.callId,
        childThreadId: childId,
        spawnCallId: origin.callId,
        rootSpawnLine: origin.line,
        childRollout: child.path,
        interactionLine: event.line,
        timestamp: event.timestamp,
      };
      const previous = misroutes.get(event.callId);
      assert.ok(!previous || previous.childThreadId === childId, "Ambiguous interaction identity");
      misroutes.set(event.callId, evidence);
    }
  }
  return [...misroutes.values()];
}

// Index only anchor metadata; unrelated tool output never enters JS memory.
function indexAnchors(db, sessionId, cutoff, anchors) {
  const affected = new Map(anchors.map(({ callId }) => [callId, []]));
  const calls = new Map(
    anchors.flatMap(({ callId, spawnCallId }) => [
      [callId, []],
      [spawnCallId, []],
    ]),
  );
  const scannedRows = db
    .prepare("SELECT COUNT(*) AS count FROM agent_messages WHERE session_id = ? AND id <= ?")
    .get(sessionId, cutoff).count;
  if (anchors.length) {
    const rows = db
      .prepare(
        "SELECT id, message_type, tool_name, tool_use_id, parent_tool_use_id, created_at FROM agent_messages WHERE session_id = ? AND id <= ? ORDER BY id",
      )
      .iterate(sessionId, cutoff);
    for (const row of rows) {
      affected.get(row.parent_tool_use_id)?.push(row);
      if (row.message_type === "tool_call") calls.get(row.tool_use_id)?.push(row);
    }
  }
  return { affected, calls, scannedRows };
}

export function buildRepairPlan(db, { sessionId, root, children, throughMessageId }) {
  assert.ok(Number.isSafeInteger(sessionId) && sessionId > 0, "Invalid session id");
  assert.ok(
    Number.isSafeInteger(throughMessageId) && throughMessageId > 0,
    "Explicit cutoff required",
  );
  const session = db
    .prepare("SELECT id, runtime_provider, runtime_session_id FROM agent_sessions WHERE id = ?")
    .get(sessionId);
  assert.ok(session, "Unknown session");
  assert.equal(session.runtime_provider, "codex_cli", "Not a Codex session");
  assert.equal(session.runtime_session_id, root.metadata.id, "Root does not match the session");
  const anchors = identifyMisroutes(root, children);
  const indexed = indexAnchors(db, sessionId, throughMessageId, anchors);
  const contentFor = db.prepare(
    "SELECT content FROM agent_messages WHERE id = ? AND session_id = ?",
  );
  const changes = [];
  const evidence = [];
  for (const anchor of anchors) {
    const affected = indexed.affected.get(anchor.callId);
    if (affected.length === 0) continue;
    const calls = indexed.calls.get(anchor.callId);
    assert.equal(calls.length, 1, "Ambiguous messaging call in stored history");
    const call = calls[0];
    assert.ok(
      ["collaboration__send_message", "collaboration__followup_task"].includes(call.tool_name),
      "Unexpected messaging tool",
    );
    assert.equal(
      call.parent_tool_use_id,
      anchor.spawnCallId,
      "Messaging call has the wrong child parent",
    );
    const spawns = indexed.calls.get(anchor.spawnCallId);
    assert.equal(spawns.length, 1, "Ambiguous child spawn block");
    const spawn = spawns[0];
    assert.ok(spawn && ["Agent", "Task"].includes(spawn.tool_name), "Missing child spawn block");
    assert.equal(
      spawn.parent_tool_use_id,
      null,
      "Ambiguous spawn ancestry: manual review required",
    );
    for (const row of affected) {
      assert.ok(row.id > call.id, "Candidate predates the messaging call");
      assert.ok(
        ["text", "thinking", "tool_call", "tool_result", "error"].includes(row.message_type),
        "Unexpected candidate type",
      );
      const content = contentFor.get(row.id, sessionId).content;
      changes.push({
        id: row.id,
        messageType: row.message_type,
        expectedParent: anchor.callId,
        proposedParent: null,
        contentSha256: hash(content),
        rowSha256: hash(JSON.stringify({ ...row, content })),
      });
    }
    evidence.push(anchor);
  }
  changes.sort((left, right) => left.id - right.id);
  assert.equal(new Set(changes.map((row) => row.id)).size, changes.length, "Duplicate candidate");
  return {
    version: 1,
    mode: "dry-run-only",
    sessionId,
    rootThreadId: root.metadata.id,
    rootRollout: root.path,
    throughMessageId,
    scannedRows: indexed.scannedRows,
    changedRows: changes.length,
    byType: changes.reduce((counts, row) => {
      counts[row.messageType] = (counts[row.messageType] ?? 0) + 1;
      return counts;
    }, {}),
    evidence,
    changes,
    beforeAnyWrite: [
      "Explicit approval of this exact plan and a quiet session/service",
      "New online SQLite backup, integrity check and preserved before/after evidence",
      "Revalidate root identity and every row hash inside the write transaction",
      "Change only listed parent_tool_use_id values; preserve content, ids and true children",
      "Preserve content/message revisions; fully reload history (incremental content sync does not carry ancestry)",
      "Reconcile live status separately with the fixed runtime; never force idle from this plan",
    ],
  };
}

async function main(args) {
  const options = { children: [] };
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    assert.ok(value, `Missing value for ${key}`);
    if (key === "--child-rollout") options.children.push(value);
    else {
      assert.ok(
        ["--database", "--session", "--root-rollout", "--through-message-id"].includes(key),
        `Unknown option ${key}; writes are not supported`,
      );
      assert.ok(!(key in options), `Duplicate option ${key}`);
      options[key] = value;
    }
  }
  assert.ok(
    options["--database"] && options["--root-rollout"] && options.children.length,
    "Provide --database, --session, --root-rollout, --child-rollout and --through-message-id",
  );
  const root = await readRollout(options["--root-rollout"]);
  const children = await Promise.all(options.children.map(readRollout));
  const db = new DatabaseSync(options["--database"], { readOnly: true });
  try {
    db.exec("PRAGMA query_only=ON; BEGIN");
    const plan = buildRepairPlan(db, {
      sessionId: Number(options["--session"]),
      throughMessageId: Number(options["--through-message-id"]),
      root,
      children,
    });
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  } finally {
    db.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`Codex repair dry-run failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
