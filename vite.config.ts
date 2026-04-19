import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 4096,
  },
  plugins: [react()],
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
    environment: "jsdom",
    globals: true,
    setupFiles: [],
    include: ["src/tests/**/*.test.ts", "src/tests/**/*.test.tsx"],
  },
});
