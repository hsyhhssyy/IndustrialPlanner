import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import Icons from "unplugin-icons/vite";
import { VitePWA } from "vite-plugin-pwa";

const PWA_MAX_CACHE_FILE_BYTES = 50 * 1024 * 1024;
let PWA_DIST_DIRECTORY = fileURLToPath(new URL("./dist/", import.meta.url));
const APP_VERSION_CACHE_KEY = encodeURIComponent(process.env.VITE_APP_VERSION?.trim() || "dev");
const PUBLIC_BASE_PATH = process.env.VITE_PUBLIC_BASE_PATH?.trim() || "./";

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

function rewriteOAuthCallbackPath(requestUrl: string | undefined): string | undefined {
  return requestUrl?.replace(
    /^\/(auth|oauth)\/callback(?=\?|$)/u,
    "/$1/callback/",
  );
}

export default defineConfig({
  base: PUBLIC_BASE_PATH,
  define: {
    "import.meta.env.VITE_APP_VERSION_CACHE_KEY": JSON.stringify(APP_VERSION_CACHE_KEY),
  },
  build: {
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        yituliuOAuthCallback: fileURLToPath(new URL("./oauth/callback/index.html", import.meta.url)),
        oauthCallback: fileURLToPath(
          new URL("./auth/callback/index.html", import.meta.url),
        ),
      },
    },
  },
  plugins: [
    {
      name: "pwa-output-directory",
      configResolved(config) {
        PWA_DIST_DIRECTORY = resolve(config.root, config.build.outDir);
      },
    },
    {
      name: "oauth-callback-path-rewrite",
      configureServer(server) {
        server.middlewares.use((request, _response, next) => {
          request.url = rewriteOAuthCallbackPath(request.url);
          next();
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use((request, _response, next) => {
          request.url = rewriteOAuthCallbackPath(request.url);
          next();
        });
      },
    },
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
      includeAssets: ["pwa-icon.svg", "pwa-icon-192.webp", "pwa-icon-512.webp"],
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
            src: "pwa-icon-192.webp",
            sizes: "192x192",
            type: "image/webp",
            purpose: "any maskable",
          },
          {
            src: "pwa-icon-512.webp",
            sizes: "512x512",
            type: "image/webp",
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
        // 高度与物流数值图均使用原始 RGBA；动画目录中的数据图随既有动画分区离线下载。
        globPatterns: ["**/*.{js,css,html,webp,svg,json,webmanifest,md,mp3}", "3d-top-view/**/*.rgba.bin"],
        globIgnores: [
          "**/sw.js",
          "**/workbox-*.js",
          // AI-REMOVED 2026-06-29:
          // Reason: 安装型离线包需要覆盖 changelog 图片，否则离线打开更新记录会缺图。
          // Trigger: 用户要求不做实时缓存，而是安装后真正离线可用。
          // Evidence: public/changelog 下存在图片资源；旧 globIgnores 会让这些资源永远不进入预缓存。
          // Replacement: globPatterns 已覆盖 gif/png/jpg/jpeg/webp/svg，SW 统一 cache-first。
          // AI-CORRECTION 2026-08-31: public 发布位图已统一为 WebP，当前 globPatterns 仅需覆盖 webp/svg 图片格式。
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
    {
      name: "oauth-callback-manifest-path",
      enforce: "post",
      transformIndexHtml: {
        order: "post",
        handler(html) {
          if (!html.includes('id="oauth-callback-root"')) {
            return html;
          }
          return html.replace(
            'href="./manifest.webmanifest"',
            'href="../../manifest.webmanifest"',
          );
        },
      },
    },
  ],
  server: {
    allowedHosts: [".hsyhhssyy.net"],
    watch: {
      ignored: ["**/.temp/**"],
    },
  },
  preview: {
    allowedHosts: [".hsyhhssyy.net"],
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
          // AI-REMOVED 2026-09-15:
          // Reason: 用户要求分析慢测试，不修改 Vitest 并发限制。
          // Trigger: 用户明确要求不要修改并发限制。
          // Evidence: maxWorkers=4 仅用于验证资源争用假设，不能作为最终修复方案。
          // Replacement: None；本次 profiling 保持 Vitest 默认并发策略。
          // Risk: Low；恢复默认并发后，原有资源争用超时会继续暴露。
          // Human Review: Required
          //
          // Original code:
          // // 常规测试包含 Sharp 素材解码与长耗时仿真，限制 worker 数避免资源争用触发默认超时。
          // maxWorkers: 4,
          // AI-CORRECTION 2026-09-16: 用户确认将 normal project 正式限制为 4 个 worker，避免资源争用触发批量超时。
          // AI-CORRECTION 2026-10-02: 2 个 worker 对照仍触发素材测试的 10 秒超时，单 worker 下相关 49 项通过；常规测试改为串行执行。
          // AI-CORRECTION 2026-10-02: 单 worker 全量用时 689 秒且仍有 10 秒超时；改为 2 worker 与 30 秒上限，控制检查耗时和偶发 I/O 延迟。
          maxWorkers: 2,
          testTimeout: 30_000,
          exclude: [
            "src/tests/contracts/**",
            "src/tests/e2e/**",
            "src/tests/layout/**",
            "src/tests/eda/**",
            "src/tests/release/**",
            "src/tests/simulation/blueprint/**",
            "src/tests/simulation/blueprint-slow/**",
            "src/tests/blueprint-planner/batch/**",
            "src/tests/blueprint-planner/training-worker.test.ts",
            "src/tests/scripts/unpack-table-source.test.ts",
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "contract",
          environment: "node",
          include: ["src/tests/contracts/**/*.test.ts"],
          fileParallelism: false,
          maxWorkers: 1,
          testTimeout: 180_000,
        },
      },
      {
        extends: true,
        test: {
          name: "layout",
          environment: "node",
          include: ["src/tests/layout/**/*.test.ts"],
          fileParallelism: false,
          maxWorkers: 1,
          maxConcurrency: 1,
          // 内部服务和 CLI 先触发有界超时，保留 finally 取证与清理时间，避免下一用例提前启动。
          testTimeout: 360_000,
        },
      },
      {
        extends: true,
        test: {
          name: "dev-tools",
          environment: "node",
          include: [
            "src/tests/blueprint-planner/training-worker.test.ts",
            "src/tests/scripts/unpack-table-source.test.ts",
          ],
          fileParallelism: false,
          maxWorkers: 1,
          maxConcurrency: 1,
          testTimeout: 30_000,
        },
      },
      // AI-REMOVED 2026-10-25:
      // Reason: 批量规划已改为独立 CLI，不再作为 Vitest 项目执行。
      // Trigger: 批处理入口迁移到 npm run eda:batch。
      // Evidence: src/scripts/run-eda.mjs 调用 src/scripts/eda/batch-command.ts；EDA 浏览器回归仍由 eda 项目运行。
      // Replacement: src/scripts/eda/batch-command.ts。
      // Risk: Low；批量规划不再由 Vitest 自动执行。Human Review: Required
      //
      // Original code:
      // {
      //   extends: true,
      //   test: {
      //     name: "eda-batch",
      //     environment: "node",
      //     include: ["src/tests/blueprint-planner/batch/**/*.test.ts"],
      //     fileParallelism: false,
      //     maxWorkers: 1,
      //     maxConcurrency: 1,
      //   },
      // },
      {
        // 2026-10-17：仅显式命令启动；真实有界面浏览器串行执行，不加入 normal/full-check。
        extends: true,
        test: {
          name: "eda",
          environment: "node",
          include: ["src/tests/eda/**/*.test.ts"],
          fileParallelism: false,
          maxWorkers: 1,
          maxConcurrency: 1,
          testTimeout: 4_200_000,
          hookTimeout: 120_000,
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
