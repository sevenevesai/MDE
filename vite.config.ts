/// <reference types="vitest" />
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { visualizer } from "rollup-plugin-visualizer";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// @ts-expect-error process is a nodejs global
const analyze = !!process.env.ANALYZE;

/** A name without extension and Vite's `-XXXXXXXX` content hash, shared by a font's .woff2/.woff/.ttf. */
const fontStem = (file: string): string => file.replace(/\.[^./]+$/, "").replace(/-[A-Za-z0-9_-]{8}$/, "");

/**
 * Output files the service worker precaches: all but itself, bundle reports, source maps, and
 * .woff/.ttf fonts with a .woff2 sibling (every service-worker browser loads the woff2).
 */
function selectPrecacheFiles(files: readonly string[]): string[] {
  const woff2 = new Set(files.filter((f) => f.endsWith(".woff2")).map(fontStem));
  return files
    .filter((f) => f !== "sw.js" && f !== "stats.html" && !f.endsWith(".map"))
    .filter((f) => !(/\.(woff|ttf)$/.test(f) && woff2.has(fontStem(f))))
    .sort();
}

const SW_BUILD_ID_LINE = 'const BUILD_ID = "dev";';
const SW_PRECACHE_LINE = "const PRECACHE = [];";

/** Fills public/sw.js's placeholder lines; index.html is cached under the scope root "./". */
function stampServiceWorker(source: string, buildId: string, files: readonly string[]): string {
  if (!source.includes(SW_BUILD_ID_LINE) || !source.includes(SW_PRECACHE_LINE)) {
    throw new Error(`public/sw.js must keep the lines '${SW_BUILD_ID_LINE}' and '${SW_PRECACHE_LINE}'`);
  }
  const urls = files.map((f) => (f === "index.html" ? "./" : f));
  return source
    .replace(SW_BUILD_ID_LINE, () => `const BUILD_ID = ${JSON.stringify(buildId)};`)
    .replace(SW_PRECACHE_LINE, () => `const PRECACHE = ${JSON.stringify(urls)};`);
}

/**
 * Stamps the copied public/sw.js with this build's file list and a content hash, so every
 * deploy installs a new service worker that precaches all lazy chunks under a fresh cache name.
 * Uses Rollup's `this.fs` because the config has no Node typings.
 */
function serviceWorkerPrecache(): Plugin {
  return {
    name: "mde-sw-precache",
    apply: "build",
    async writeBundle(output) {
      const outDir = output.dir;
      if (!outDir) throw new Error("mde-sw-precache needs build.outDir");
      const fs = this.fs;

      const list = async (dir: string): Promise<string[]> => {
        const found: string[] = [];
        for (const entry of await fs.readdir(`${outDir}/${dir}`, { withFileTypes: true })) {
          const rel = dir ? `${dir}/${entry.name}` : entry.name;
          if (entry.isDirectory()) found.push(...(await list(rel)));
          else found.push(rel);
        }
        return found;
      };
      const files = selectPrecacheFiles(await list(""));

      // The worker's own source counts too, so a change to its logic alone also gets a fresh cache.
      const encoder = new TextEncoder();
      const parts: Uint8Array[] = [];
      for (const file of [...files, "sw.js"]) parts.push(encoder.encode(`${file}\0`), await fs.readFile(`${outDir}/${file}`));
      const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let offset = 0;
      for (const p of parts) {
        all.set(p, offset);
        offset += p.length;
      }
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", all));
      const buildId = Array.from(digest.slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");

      const swPath = `${outDir}/sw.js`;
      const source = await fs.readFile(swPath, { encoding: "utf8" });
      await fs.writeFile(swPath, stampServiceWorker(source, buildId, files));
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    react(),
    tailwindcss(),
    serviceWorkerPrecache(),
    // `npm run analyze` writes a treemap of the production bundle to dist/stats.html.
    ...(analyze
      ? [visualizer({ filename: "dist/stats.html", template: "treemap", gzipSize: true, brotliSize: true, open: true })]
      : []),
  ],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  // Vitest config
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
}));
