import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { interceptorPlugin } from "@vitest/mocker/node";
import browserslist from "browserslist";
import postcss from "postcss";
import { optimize } from "svgo";

test("PostCSS transforms valid CSS without loading a source map when from is unset", async (context) => {
  const root = mkdtempSync(join(tmpdir(), "cadencr-postcss-security-"));
  context.after(() => rmSync(root, { force: true, recursive: true }));
  const mapPath = join(root, "untrusted.map");
  writeFileSync(
    mapPath,
    JSON.stringify({ version: 3, sources: ["secret.css"], names: [], mappings: "AAAA" }),
  );

  const uppercaseColors = {
    postcssPlugin: "uppercase-colors",
    Declaration(declaration) {
      declaration.value = declaration.value.toUpperCase();
    },
  };
  const input = `.button { color: red; }\n/*# sourceMappingURL=${mapPath} */`;
  const result = await postcss([uppercaseColors]).process(input);

  assert.match(result.css, /color: RED/);
  assert.equal(result.map, undefined);
  assert.equal(result.root.first?.source?.input.map, undefined);
});

test("Browserslist handles prototype-named custom stats without crashing", () => {
  const result = browserslist("defaults", {
    stats: {
      toString: { onekey: 5 },
      chrome: { 100: 50 },
    },
  });

  assert.ok(result.length > 0);
  assert.ok(result.every((browser) => typeof browser === "string"));
});

test("Browserslist evicts old results from its bounded query cache", () => {
  const first = browserslist("since 1900-01-01");
  for (let offset = 1; offset <= 500; offset += 1) {
    const date = new Date(Date.UTC(1900, 0, 1) + offset * 86_400_000).toISOString().slice(0, 10);
    browserslist(`since ${date}`);
  }

  assert.notEqual(browserslist("since 1900-01-01"), first);
});

test("Baseline browser mapping throws for invalid options instead of terminating the process", () => {
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { getCompatibleVersions } from "baseline-browser-mapping";
try {
  getCompatibleVersions({ includeDownstreamBrowsers: false, includeKaiOS: true });
  process.exitCode = 2;
} catch { console.log("threw"); }`,
    ],
    { cwd: process.cwd(), encoding: "utf8", timeout: 10_000 },
  );

  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr || child.stdout);
  assert.equal(child.stdout.trim(), "threw");
});

test("Vitest mocker only registers redirect mocks inside Vite's file allowlist", async (context) => {
  const root = mkdtempSync(join(tmpdir(), "cadencr-vitest-mocker-"));
  context.after(() => rmSync(root, { force: true, recursive: true }));
  writeFileSync(join(root, "fixture.js"), "export const safe = true;");
  const handlers = new Map();
  const plugin = interceptorPlugin();
  plugin.configureServer({
    config: {
      root,
      server: { fs: { strict: true, allow: [root] } },
      fsDenyGlob: () => false,
      safeModulePaths: new Set(),
    },
    ws: {
      on: (event, handler) => handlers.set(event, handler),
      send: () => {},
    },
  });
  const register = handlers.get("vitest:interceptor:register");
  assert.equal(typeof register, "function");

  register({
    type: "redirect",
    raw: "outside",
    id: "/virtual/outside.js",
    url: "/virtual/outside.js",
    redirect: "mock:../../outside.js",
  });
  assert.equal(await plugin.load.handler("/virtual/outside.js"), undefined);

  register({
    type: "redirect",
    raw: "inside",
    id: "/virtual/inside.js",
    url: "/virtual/inside.js",
    redirect: "mock:fixture.js",
  });
  assert.equal(await plugin.load.handler("/virtual/inside.js"), "export const safe = true;");
});

test("SVGO still performs normal default optimizations", () => {
  const input =
    '<svg xmlns="http://www.w3.org/2000/svg"><!-- unused --><rect width="10" height="10" fill="#ff0000"/></svg>';
  const result = optimize(input);

  assert.ok(result.data.length < input.length);
  assert.doesNotMatch(result.data, /unused/);
  assert.match(result.data, /<path /);
});

test("SVGO removeScripts strips executable HTML from foreignObject", () => {
  const input = [
    '<svg xmlns="http://www.w3.org/2000/svg">',
    '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml" onload="alert(1)">',
    '<p>Safe content</p><iframe srcdoc="&lt;script>alert(1)&lt;/script>"/>',
    "</div></foreignObject></svg>",
  ].join("");
  const result = optimize(input, { plugins: ["removeScripts"] });

  assert.match(result.data, /Safe content/);
  assert.doesNotMatch(result.data, /onload|srcdoc|script/i);
});

test("SVGO removeScripts rejects namespace and control-character URL bypasses", () => {
  const input = [
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:svg="http://www.w3.org/2000/svg">',
    '<svg:a href="java&#9;script:alert(1)"><text>Click</text></svg:a>',
    "</svg>",
  ].join("");
  const result = optimize(input, { plugins: ["removeScripts"] });

  assert.doesNotMatch(result.data, /java[\t\n\r]*script:/i);
});
