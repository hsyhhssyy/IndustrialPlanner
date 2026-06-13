import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import Icons from "unplugin-icons/vite";
import { VitePWA } from "vite-plugin-pwa";

const PWA_MAX_CACHE_FILE_BYTES = 50 * 1024 * 1024;

export default defineConfig({
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
      scope: "/",
      manifestFilename: "manifest.webmanifest",
      includeAssets: ["pwa-icon.svg", "pwa-icon-192.png", "pwa-icon-512.png"],
      manifest: {
        name: "集成工业仿真",
        short_name: "工业仿真",
        description: "离线可用的工业规划与仿真工具",
        lang: "zh-CN",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#15231f",
        theme_color: "#15231f",
        icons: [
          {
            src: "/pwa-icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any maskable",
          },
          {
            src: "/pwa-icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
          {
            src: "/pwa-icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,ico,png,webp,svg,jpg,jpeg,json,webmanifest,md}"],
        globIgnores: ["**/sw.js", "**/workbox-*.js", "changelog/**/*.{png,jpg,jpeg,webp,svg,gif}"],
        maximumFileSizeToCacheInBytes: PWA_MAX_CACHE_FILE_BYTES,
        manifestTransforms: [
          (entries) => ({
            manifest: entries.map((entry) => ({
              integrity: entry.integrity,
              revision: entry.revision,
              size: entry.size,
              url: entry.url,
            })),
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
          exclude: ["src/tests/simulation/blueprint/**"],
        },
      },
      {
        // 继承根配置的 resolve.alias、plugins 等，但独立设置 test 选项
        extends: true,
        test: {
          name: "blueprint",
          include: ["src/tests/simulation/blueprint/**"],
          // 蓝图仿真测试耗时长，强制串行避免资源争抢
          fileParallelism: false,
          testTimeout: 120_000,
        },
      },
    ],
  },
});
