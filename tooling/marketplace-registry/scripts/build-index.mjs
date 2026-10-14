#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalJson,
  comparePackages,
  loadPackages,
  validateIndex,
  validatePackage,
} from "./lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputFlag = process.argv.indexOf("--output");
const output = outputFlag === -1 ? null : process.argv[outputFlag + 1];
if (outputFlag !== -1 && !output) throw new Error("--output requires a path");
const generatedFlag = process.argv.indexOf("--generated-at");
const expiresFlag = process.argv.indexOf("--expires-at");
const generatedAt = generatedFlag === -1 ? null : process.argv[generatedFlag + 1];
const expiresAt = expiresFlag === -1 ? null : process.argv[expiresFlag + 1];
if (!generatedAt || !expiresAt)
  throw new Error("--generated-at and --expires-at are required RFC 3339 timestamps");

const loaded = await loadPackages(path.join(root, "packages"));
const failures = loaded.flatMap(({ file, value }) => validatePackage(value, file));
if (failures.length) throw new Error(`package validation failed:\n${failures.join("\n")}`);
const index = {
  schema_version: 1,
  generated_at: generatedAt,
  expires_at: expiresAt,
  packages: loaded.map(({ value }) => value).sort(comparePackages),
};
const indexErrors = validateIndex(index);
if (indexErrors.length) throw new Error(`index validation failed:\n${indexErrors.join("\n")}`);
const bytes = canonicalJson(index);
if (output) {
  await mkdir(path.dirname(path.resolve(output)), { recursive: true });
  await writeFile(output, bytes, { flag: "wx" });
  console.log(`wrote canonical unsigned index: ${output}`);
} else {
  process.stdout.write(bytes);
}
