import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import Icons from "unplugin-icons/vite";
import { VitePWA } from "vite-plugin-pwa";

const PWA_MAX_CACHE_FILE_BYTES = 50 * 1024 * 1024;
const PWA_DIST_DIRECTORY = fileURLToPath(new URL("./dist/", import.meta.url));
const APP_VERSION_CACHE_KEY = encodeURIComponent(process.env.VITE_APP_VERSION?.trim() || "dev");

interface WorkboxManifestEntryWithSize {
  readonly integrity?: string;
  readonly revision: string | null;
  readonly size: number;
  readonly url: string;
}

interface IndustrialPlannerPrecacheManifestEntry extends WorkboxManifestEntryWithSize {
  readonly bytes: number;
  readonly sha256: string;
}

async function createIndustrialPlannerPrecacheManifestEntry(
  entry: WorkboxManifestEntryWithSize,
): Promise<IndustrialPlannerPrecacheManifestEntry> {
  const fileBuffer = await readFile(resolvePrecacheFilePath(entry.url));

  return {
    integrity: entry.integrity,
    revision: entry.revision,
    size: entry.size,
    bytes: fileBuffer.byteLength,
    sha256: createHash("sha256").update(fileBuffer).digest("hex"),
    url: entry.url,
  };
}

function resolvePrecacheFilePath(entryUrl: string): string {
  const url = new URL(entryUrl, "https://industrial-planner.local/");
  const relativeFilePath = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  const filePath = resolve(PWA_DIST_DIRECTORY, relativeFilePath);
  const pathInsideDist = relative(PWA_DIST_DIRECTORY, filePath);

  if (pathInsideDist.startsWith("..") || isAbsolute(pathInsideDist)) {
    throw new Error(`Invalid PWA precache path: ${entryUrl}`);
  }

  return filePath;
}

export default defineConfig({
  base: "./",
  define: {
    "import.meta.env.VITE_APP_VERSION_CACHE_KEY": JSON.stringify(APP_VERSION_CACHE_KEY),
  },
  build: {
    chunkSizeWarningLimit: 4096,
  },
  plugins: [
    react(),
    Icons({
      compiler: "jsx",
      jsx: "react",
    }),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src/app/pwa",
      filename: "sw.ts",
      injectRegister: false,
      registerType: "prompt",
      scope: "./",
      manifestFilename: "manifest.webmanifest",
      includeAssets: ["pwa-icon.svg", "pwa-icon-192.png", "pwa-icon-512.png"],
      manifest: {
        name: "集成工业仿真",
        short_name: "工业仿真",
        description: "离线可用的工业规划与仿真工具",
        lang: "zh-CN",
        start_url: ".",
        scope: ".",
        display: "standalone",
        background_color: "#15231f",
        theme_color: "#15231f",
        icons: [
          {
            src: "pwa-icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any maskable",
          },
          {
            src: "pwa-icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
          {
            src: "pwa-icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,ico,png,webp,svg,gif,jpg,jpeg,json,webmanifest,md}"],
        globIgnores: [
          "**/sw.js",
          "**/workbox-*.js",
          // AI-REMOVED 2026-06-29:
          // Reason: 安装型离线包需要覆盖 changelog 图片，否则离线打开更新记录会缺图。
          // Trigger: 用户要求不做实时缓存，而是安装后真正离线可用。
          // Evidence: public/changelog 下存在图片资源；旧 globIgnores 会让这些资源永远不进入预缓存。
          // Replacement: globPatterns 已覆盖 gif/png/jpg/jpeg/webp/svg，SW 统一 cache-first。
          // Risk: 离线包体积增加；通过哈希复用和并发下载降低更新成本。
          // Human Review: Required
          //
          // Original code:
          // "changelog/**/*.{png,jpg,jpeg,webp,svg,gif}",
        ],
        maximumFileSizeToCacheInBytes: PWA_MAX_CACHE_FILE_BYTES,
        manifestTransforms: [
          async (entries) => ({
            manifest: await Promise.all(entries.map(createIndustrialPlannerPrecacheManifestEntry)),
            warnings: [],
          }),
        ],
      },
    }),
  ],
  server: {
    allowedHosts: ["industrialplanner-refactor-cf01ab.coder-page.hsyhhssyy.net"],
  },
  preview: {
    allowedHosts: ["industrialplanner-refactor-cf01ab.coder-page.hsyhhssyy.net"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // 全局配置（reporter、coverage 等放这里）
    environment: "jsdom",
    globals: true,
    setupFiles: [],

    projects: [
      {
        // 常规测试，继承根配置，默认并行
        extends: true,
        test: {
          name: "normal",
          include: ["src/tests/**/*.test.ts", "src/tests/**/*.test.tsx"],
          exclude: [
            "src/tests/e2e/**",
            "src/tests/simulation/blueprint/**",
            "src/tests/simulation/blueprint-slow/**",
          ],
        },
      },
      {
        // 继承根配置的 resolve.alias、plugins 等，但独立设置 test 选项
        extends: true,
        test: {
          name: "blueprint",
          include: ["src/tests/simulation/blueprint/**"],
          // 蓝图仿真测试内存密集，串行执行防止 OOM
          fileParallelism: false,
          maxConcurrency: 1,
          testTimeout: 120_000,
        },
      },
      {
        // 长耗时蓝图仿真测试，独立 project 与 blueprint 并行执行
        extends: true,
        test: {
          name: "blueprint-slow",
          include: ["src/tests/simulation/blueprint-slow/**"],
          fileParallelism: false,
          maxConcurrency: 1,
          testTimeout: 1_800_000,
        },
      },
    ],
  },
});
