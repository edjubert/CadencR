#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { canonicalJson, validateIndex, validateSignedIndex } from "./lib.mjs";

const [payloadFile, signatureFile, outputFile] = process.argv.slice(2);
if (!payloadFile || !signatureFile || !outputFile) {
  throw new Error("usage: assemble-signed-index.mjs PAYLOAD SIGNATURE OUTPUT");
}
const signed = JSON.parse(await readFile(payloadFile, "utf8"));
const signature = JSON.parse(await readFile(signatureFile, "utf8"));
const payloadErrors = validateIndex(signed);
if (payloadErrors.length)
  throw new Error(`payload validation failed:\n${payloadErrors.join("\n")}`);
const envelope = { signed, signature };
const errors = validateSignedIndex(envelope);
if (errors.length) throw new Error(`envelope validation failed:\n${errors.join("\n")}`);
await writeFile(outputFile, `${canonicalJson(envelope)}\n`, { flag: "wx" });
console.log(`assembled signed index without executing contributor code: ${outputFile}`);
