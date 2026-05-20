/// <reference types="vite/client" />
/// <reference types="unplugin-icons/types/react" />

// AI-GENERATED 2026-05-20: CI build 时将 tag 写入 public/version.js，暴露为全局变量。
declare global {
  interface Window {
    /** CI 构建时写入的 tag（如 "v1.2.3-beta1"），dev 模式下为 undefined */
    __APP_VERSION__?: string;
  }
}

export {};
