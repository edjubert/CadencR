#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPackages, validateIndex, validatePackage, validateSignedIndex } from "./lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputs = process.argv.slice(2);
const results =
  inputs.length === 0
    ? await loadPackages(path.join(root, "packages"))
    : await Promise.all(
        inputs.map(async (file) => ({ file, value: JSON.parse(await readFile(file, "utf8")) })),
      );

let failed = false;
for (const { file, value } of results) {
  const errors =
    value?.signed && value?.signature
      ? validateSignedIndex(value)
      : value?.schema_version !== undefined
        ? validateIndex(value)
        : validatePackage(value);
  if (errors.length === 0) {
    console.log(`valid: ${file}`);
  } else {
    failed = true;
    console.error(`invalid: ${file}`);
    for (const error of errors) console.error(`  - ${error}`);
  }
}
if (failed) process.exitCode = 1;
