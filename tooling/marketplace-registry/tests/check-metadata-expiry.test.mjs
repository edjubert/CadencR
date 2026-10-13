import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkExpiry } from "../scripts/check-metadata-expiry.mjs";

test("expiry diagnostic fails closed on malformed, stale, near-expiry and unsafe files", async () => {
  const root = await mkdtemp(join(tmpdir(), "registry-expiry-"));
  const file = join(root, "metadata.json");
  const now = Date.parse("2026-10-12T00:00:00Z");
  const put = (expires_at) =>
    writeFile(
      file,
      JSON.stringify({
        signed: {
          schema_version: 2,
          generated_at: "2026-10-11T00:00:00Z",
          expires_at,
          packages: [],
        },
        signature: { algorithm: "ed25519", key_id: "fixture", value: "not-authenticated" },
      }),
    );
  try {
    await put("2026-10-20T00:00:00Z");
    assert.equal((await checkExpiry(file, { now })).status, "healthy");
    assert.equal((await checkExpiry(file, { now })).authenticated, false);
    await put("2026-10-15T00:00:00Z");
    assert.equal((await checkExpiry(file, { now })).status, "renewal-due");
    await put("2026-10-12T00:00:00Z");
    assert.equal((await checkExpiry(file, { now })).status, "expired");
    await put("2026-02-30T00:00:00Z");
    await assert.rejects(checkExpiry(file, { now }));
    await writeFile(file, "{");
    await assert.rejects(checkExpiry(file, { now }));
    await symlink(file, join(root, "link"));
    await assert.rejects(checkExpiry(join(root, "link"), { now }));
    await assert.rejects(checkExpiry(root, { now }));
    await assert.rejects(checkExpiry(file, { now, warningHours: 0 }));
    await writeFile(file, Buffer.alloc(32 * 1024 * 1024 + 1));
    await assert.rejects(checkExpiry(file, { now }));
  } finally {
    await rm(root, { recursive: true });
  }
});

test("CLI handles signed catalog and domain policy envelopes with truthful exit status", async () => {
  const root = await mkdtemp(join(tmpdir(), "registry-expiry-cli-"));
  const file = join(root, "envelope.json");
  const cli = fileURLToPath(new URL("../scripts/check-metadata-expiry.mjs", import.meta.url));
  const run = (...files) => spawnSync(process.execPath, [cli, ...files], { encoding: "utf8" });
  const now = Math.floor(Date.now() / 1000) * 1000;
  const time = (offset) => new Date(now + offset).toISOString().replace(".000Z", "Z");
  try {
    for (const payload of [
      { schema_version: 2, packages: [] },
      { schema_version: 1, kind: "theme-blocklist", entries: [] },
      { schema_version: 1, kind: "provider-blocklist", entries: [] },
    ]) {
      await writeFile(
        file,
        JSON.stringify({
          signed: { ...payload, generated_at: time(-60000), expires_at: time(96 * 3600000) },
          signature: {},
        }),
      );
      const result = run(file);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).results[0].authenticated, false);
    }
    await writeFile(
      file,
      JSON.stringify({
        signed: { generated_at: time(-60000), expires_at: time(3600000) },
        signature: {},
      }),
    );
    assert.equal(run(file).status, 1);
    for (const envelope of [
      {},
      { signed: [], signature: {} },
      { signed: {}, signature: [] },
      { signed: { generated_at: time(60000), expires_at: time(3600000) }, signature: {} },
      { signed: { generated_at: time(-60000), expires_at: time(-60000) }, signature: {} },
    ]) {
      await writeFile(file, JSON.stringify(envelope));
      assert.equal(run(file).status, 1);
    }
    assert.equal(run().status, 1);
    assert.equal(run(file, file, file, file).status, 1);
    assert.equal(run(join(root, "missing")).status, 1);
  } finally {
    await rm(root, { recursive: true });
  }
});
