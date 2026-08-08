import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import type { Plugin } from "vite";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-vite-plugin";
import {
  rendererCsp,
  resolveRendererCspDevelopment,
  type RendererCspDevelopmentEndpoints,
} from "./electron/main/csp";
import {
  electronBundleContractPlugin,
  type ElectronBundleContract,
} from "./electron/bundle-contract";
import pkg from "./package.json" with { type: "json" };

const excalidrawFontsDir = path.join(
  path.dirname(createRequire(import.meta.url).resolve("@excalidraw/excalidraw")),
  "fonts",
);

/**
 * Serves Excalidraw's fonts (Excalifont, Nunito, …) from the renderer origin
 * so they satisfy the `font-src 'self'` CSP — Excalidraw's default CDN fetch is
 * blocked. In dev a middleware streams them from `node_modules`; for the
 * packaged build they're copied into `out/renderer/fonts`. The runtime base is
 * set via `window.EXCALIDRAW_ASSET_PATH` (see `excalidraw-asset-path.ts`).
 */
function excalidrawFontsPlugin(): Plugin {
  let outDir = "";
  return {
    name: "cadencr-excalidraw-fonts",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/fonts/")) return next();
        const rel = decodeURIComponent(req.url.slice("/fonts/".length).split(/[?#]/)[0]);
        const filePath = path.join(excalidrawFontsDir, rel);
        if (!filePath.startsWith(excalidrawFontsDir + path.sep)) {
          res.statusCode = 403;
          res.end("Forbidden");
          return;
        }
        fs.readFile(filePath, (err, data) => {
          if (err) return next();
          if (filePath.endsWith(".woff2")) res.setHeader("Content-Type", "font/woff2");
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          res.end(data);
        });
      });
    },
    closeBundle() {
      if (!outDir) return;
      fs.cpSync(excalidrawFontsDir, path.join(outDir, "fonts"), { recursive: true });
    },
  };
}

function cspMetaPlugin(
  isProduction: boolean,
  developmentEndpoints: RendererCspDevelopmentEndpoints,
): Plugin {
  return {
    name: "cadencr-csp-meta",
    transformIndexHtml: () => [
      {
        tag: "meta",
        attrs: {
          "http-equiv": "Content-Security-Policy",
          content: rendererCsp(isProduction, developmentEndpoints),
        },
        injectTo: "head",
      },
    ],
  };
}

/**
 * Git branch this bundle is built from, consumed by the sidebar environment
 * badge (see `src/lib/app-environment.ts`): a `vX.Y.Z` integration branch shows
 * its version, anything else shows BETA. Packaged release builds check out a
 * tag, so HEAD is detached and they land on BETA.
 */
function resolveBuildBranch(): string {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: __dirname,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (error) {
    // Not fatal: building outside a git checkout just means no branch badge.
    console.warn(`[cadencr] could not resolve the build branch: ${String(error)}`);
    return "";
  }
}

const electronBundleContracts = {
  main: {
    processName: "main",
    entryFileName: path.basename(pkg.main),
    externalizationSentinels: ["electron", "electron-updater", "dotenv"],
  },
  preload: {
    processName: "preload",
    entryFileName: "index.js",
    externalizationSentinels: ["electron"],
  },
} as const satisfies Record<"main" | "preload", ElectronBundleContract>;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "VITE_");
  const development = resolveRendererCspDevelopment(env);
  return {
    main: {
      plugins: [
        externalizeDepsPlugin(),
        electronBundleContractPlugin(electronBundleContracts.main),
      ],
      build: {
        rollupOptions: {
          input: path.resolve(__dirname, "electron/main/index.ts"),
        },
      },
    },
    preload: {
      plugins: [
        externalizeDepsPlugin(),
        electronBundleContractPlugin(electronBundleContracts.preload),
      ],
      build: {
        rollupOptions: {
          input: path.resolve(__dirname, "electron/preload/index.ts"),
        },
      },
    },
    renderer: {
      root: ".",
      envDir: __dirname,
      envPrefix: "VITE_",
      server: {
        host: "127.0.0.1",
        port: development.frontendPort,
        strictPort: true,
      },
      define: {
        __APP_VERSION__: JSON.stringify(pkg.version),
        __APP_BUILD_BRANCH__: JSON.stringify(resolveBuildBranch()),
      },
      resolve: {
        alias: {
          "@": path.resolve(__dirname, "src"),
        },
      },
      plugins: [
        react(),
        tailwindcss(),
        excalidrawFontsPlugin(),
        cspMetaPlugin(mode === "production", development),
        TanStackRouterVite({
          routesDirectory: "src/routes",
          generatedRouteTree: "src/routeTree.gen.ts",
          routeFileIgnorePattern: ".test.tsx?$",
        }),
      ],
      build: {
        rollupOptions: {
          input: path.resolve(__dirname, "index.html"),
        },
      },
    },
  };
});
