import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import Icons from "unplugin-icons/vite";

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
