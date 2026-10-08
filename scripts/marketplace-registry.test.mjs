import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

test("registry tooling stays covered by the root test suite", () => {
  const cwd = fileURLToPath(new URL("../tooling/marketplace-registry/", import.meta.url));
  const tests = readdirSync(`${cwd}/tests`).filter((name) => name.endsWith(".test.mjs"));
  const result = spawnSync(process.execPath, ["--test", ...tests.map((name) => `tests/${name}`)], {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("portable registry fixtures stay byte-identical to the service contract", () => {
  for (const name of ["valid.json", "valid.signing.json"]) {
    const service = new URL(
      `../packages/service/tests/fixtures/managed_provider_index/v1/${name}`,
      import.meta.url,
    );
    const portable = new URL(
      `../tooling/marketplace-registry/tests/fixtures/${name}.fixture`,
      import.meta.url,
    );
    assert.deepEqual(readFileSync(portable), readFileSync(service));
  }
});
