import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const desktopRequire = createRequire(new URL("../packages/desktop/package.json", import.meta.url));
const orvalManifestPath = desktopRequire.resolve("orval/package.json");
const orvalManifest = JSON.parse(readFileSync(orvalManifestPath, "utf8"));
const orvalBin = join(dirname(orvalManifestPath), orvalManifest.bin.orval);
const typescript = desktopRequire("typescript");
const PROCESS_TIMEOUT_MS = 10_000;

function fixture(context, input = "./openapi.json") {
  const directory = mkdtempSync(join(tmpdir(), "cadencr-orval-security-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const output = join(directory, "generated.ts");
  writeFileSync(
    join(directory, "client.ts"),
    "export const customInstance = <T>(config: unknown): Promise<T> => Promise.resolve(config as T);\n",
  );
  writeFileSync(
    join(directory, "orval.config.cjs"),
    `module.exports = {
  fixture: {
    input: ${JSON.stringify(input)},
    output: {
      target: "./generated.ts",
      client: "react-query",
      httpClient: "axios",
      mode: "single",
      override: {
        mutator: { path: "./client.ts", name: "customInstance" },
        query: { version: 5 },
      },
    },
  },
};\n`,
  );
  return { directory, output };
}

function spec(paths) {
  return {
    openapi: "3.0.3",
    info: { title: "Bounded Orval security fixture", version: "1.0.0" },
    paths,
  };
}

function operation(operationId, schema = { type: "string" }) {
  return {
    operationId,
    parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
    responses: {
      200: {
        description: "ok",
        content: { "application/json": { schema } },
      },
    },
  };
}

function runOrval(directory) {
  const result = spawnSync(process.execPath, [orvalBin, "--config", "./orval.config.cjs"], {
    cwd: directory,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    timeout: PROCESS_TIMEOUT_MS,
  });
  assert.equal(result.error, undefined, result.error?.message);
  return result;
}

function writeSpec(directory, value) {
  writeFileSync(join(directory, "openapi.json"), JSON.stringify(value));
}

function assertGenerationSucceeded(result) {
  assert.equal(result.signal, null, result.stderr || result.stdout);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test("an OpenAPI path-template breakout remains data in generated TypeScript", (context) => {
  const { directory, output } = fixture(context);
  const marker = "__ORVAL_PATH_INJECTION_MARKER__";
  const hostilePath = `/widgets/\` + (globalThis.${marker} = "executed") + \`/{id}`;
  writeSpec(directory, spec({ [hostilePath]: { get: operation("hostile_widget") } }));

  const result = runOrval(directory);
  assertGenerationSucceeded(result);
  const generated = readFileSync(output, "utf8");
  assert.match(generated, new RegExp(marker));
  const source = typescript.createSourceFile(
    "generated.ts",
    generated,
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.TS,
  );
  assert.deepEqual(source.parseDiagnostics, [], "hostile path must still produce valid TypeScript");
  let markerIsExecutable = false;
  const visit = (node) => {
    if (typescript.isIdentifier(node) && node.text === marker) markerIsExecutable = true;
    typescript.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(markerIsExecutable, false, "path marker escaped into an executable property access");
});

test("remote $ref is rejected before generation", (context) => {
  const { directory } = fixture(context);
  // Accept only Orval's pre-resolution policy error. A connection error or a
  // response from this bounded loopback URL therefore fails the assertion.
  const remoteRef = "http://127.0.0.1:9/schema.json#/SafeRemoteSchema";
  writeSpec(
    directory,
    spec({ "/widgets/{id}": { get: operation("get_widget", { $ref: remoteRef }) } }),
  );

  const result = runOrval(directory);
  assert.notEqual(result.status, 0, "remote $ref unexpectedly generated a client");
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /external \$ref targets are not allowed/i,
    "failure must be Orval's remote-reference policy, not a network response",
  );
});

test("absolute and parent-relative local $refs cannot escape the input directory", async (context) => {
  for (const refKind of ["absolute", "parent-relative"]) {
    await context.test(refKind, (subcontext) => {
      const { directory, output } = fixture(subcontext, "./spec/openapi.json");
      const specDirectory = join(directory, "spec");
      mkdirSync(specDirectory);
      const outside = join(directory, "outside.json");
      const marker = `OUT_OF_TREE_${refKind.replace("-", "_").toUpperCase()}`;
      writeFileSync(
        outside,
        JSON.stringify({
          LeakedSchema: { type: "object", properties: { [marker]: { type: "string" } } },
        }),
      );
      const ref =
        refKind === "absolute" ? `${outside}#/LeakedSchema` : `../outside.json#/LeakedSchema`;
      writeSpec(
        specDirectory,
        spec({ "/widgets/{id}": { get: operation("get_widget", { $ref: ref }) } }),
      );
      const result = runOrval(directory);
      assert.notEqual(result.status, 0, `${refKind} $ref unexpectedly generated a client`);
      assert.match(
        `${result.stdout}\n${result.stderr}`,
        /external \$ref targets are not allowed/i,
        `${refKind} failure must be Orval's external-reference policy`,
      );
      if (existsSync(output)) {
        assert.doesNotMatch(readFileSync(output, "utf8"), new RegExp(marker));
      }
    });
  }
});
