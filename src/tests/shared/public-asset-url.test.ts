import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDeviceIconAssetUrl,
  createItemIconAssetUrl,
  createPublicAssetUrl,
  isRootPublicAssetBaseUrl,
} from "@/shared/browser/public-asset-url";

afterEach(() => {
  window.history.replaceState(null, "", "/");
  vi.unstubAllEnvs();
});

describe("public asset url", () => {
  it("keeps public assets relative when Vite base is relative", () => {
    vi.stubEnv("BASE_URL", "./");
    window.history.replaceState(null, "", "/nested/prefix/v3/");

    expect(createPublicAssetUrl("help/getting-started.md")).toBe("./help/getting-started.md");
    expect(createPublicAssetUrl("/textures/scanline-45deg-50opacity.png")).toBe("./textures/scanline-45deg-50opacity.png");
    expect(createDeviceIconAssetUrl("item_log_belt_01")).toBe("./device-icons/item_log_belt_01.webp");
    expect(createItemIconAssetUrl("item_iron_ore")).toBe("./item-icons/item_iron_ore.webp");
    expect(createPublicAssetUrl("https://example.com/static.png")).toBe("https://example.com/static.png");
    expect(isRootPublicAssetBaseUrl()).toBe(false);
  });

  it("allows root PWA when the relative build is served from domain root", () => {
    vi.stubEnv("BASE_URL", "./");

    window.history.replaceState(null, "", "/");
    expect(isRootPublicAssetBaseUrl()).toBe(true);

    window.history.replaceState(null, "", "/index.html");
    expect(isRootPublicAssetBaseUrl()).toBe(true);

    window.history.replaceState(null, "", "/nested/prefix/v3/");
    expect(isRootPublicAssetBaseUrl()).toBe(false);
  });

  it("normalizes public assets for root and nested absolute bases", () => {
    vi.stubEnv("BASE_URL", "/");
    expect(createPublicAssetUrl("help/getting-started.md")).toBe("/help/getting-started.md");
    // AI-REMOVED 2026-08-19:
    // Reason: ../v2/ 跨目录解析仅服务于已退出的顶栏旧版链接。
    // Trigger: 用户要求从下个版本开始界面不再显示“返回旧版”。
    // Evidence: 生产代码已不存在以 ../v2/ 调用 createPublicAssetUrl 的路径。
    // Replacement: TopBar 测试直接验证不存在指向 v2 的链接。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // expect(createPublicAssetUrl("../v2/")).toBe("/v2/");
    expect(isRootPublicAssetBaseUrl()).toBe(true);

    vi.stubEnv("BASE_URL", "/nested/prefix/v3/");
    expect(createPublicAssetUrl("help/getting-started.md")).toBe("/nested/prefix/v3/help/getting-started.md");
    // AI-REMOVED 2026-08-19:
    // Reason: ../v2/ 跨目录解析仅服务于已退出的顶栏旧版链接。
    // Trigger: 用户要求从下个版本开始界面不再显示“返回旧版”。
    // Evidence: 生产代码已不存在以 ../v2/ 调用 createPublicAssetUrl 的路径。
    // Replacement: TopBar 测试直接验证不存在指向 v2 的链接。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // expect(createPublicAssetUrl("../v2/")).toBe("/nested/prefix/v2/");
    expect(isRootPublicAssetBaseUrl()).toBe(false);
  });
});
