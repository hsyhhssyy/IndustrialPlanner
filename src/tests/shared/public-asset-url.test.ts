import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createAbsolutePublicAssetUrl,
  createDeviceIconAssetUrl,
  createEntityIconAssetUrl,
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
    expect(createPublicAssetUrl("/textures/scanline-45deg-50opacity.webp")).toBe("./textures/scanline-45deg-50opacity.webp");
    expect(createDeviceIconAssetUrl("item_log_belt_01")).toBe("./device-icons/item_log_belt_01.webp");
    // AI-CORRECTION 2026-10-15: 图标入口现在检查交付文件，URL语义使用真实素材验证，缺图另测占位符。
    expect(createEntityIconAssetUrl("device-icons/item_port_filling_pd_mc_1.webp")).toBe("./device-icons/item_port_filling_pd_mc_1.webp");
    expect(createEntityIconAssetUrl(undefined)).toBe("./textures/missing-sprite-texture.webp");
    expect(createItemIconAssetUrl("item_iron_ore")).toBe("./item-icons/item_iron_ore.webp");
    expect(createPublicAssetUrl("https://example.com/static.png")).toBe("https://example.com/static.png");
    expect(createAbsolutePublicAssetUrl("input-prompts/keyboard_w_outline.svg")).toBe(
      `${window.location.origin}/nested/prefix/v3/input-prompts/keyboard_w_outline.svg`,
    );
    expect(createAbsolutePublicAssetUrl("https://example.com/static.png")).toBe(
      "https://example.com/static.png",
    );
    expect(isRootPublicAssetBaseUrl()).toBe(false);
  });

  it("缺失物品和设备图标统一使用占位符，并遵守相对及SHA子路径base", () => {
    for (const [base, prefix] of [["./", "./"], ["/", "/"], ["/full-commit-sha/", "/full-commit-sha/"]] as const) {
      vi.stubEnv("BASE_URL", base);
      const expected = `${prefix}textures/missing-sprite-texture.webp`;
      expect(createItemIconAssetUrl("__missing_item_icon__")).toBe(expected);
      expect(createDeviceIconAssetUrl("__missing_device_icon__")).toBe(expected);
      expect(createEntityIconAssetUrl("device-icons/__missing_device_icon__.webp")).toBe(expected);
      expect(createItemIconAssetUrl("item_iron_ore")).toBe(`${prefix}item-icons/item_iron_ore.webp`);
    }
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
    expect(createAbsolutePublicAssetUrl("input-prompts/keyboard_w_outline.svg")).toBe(
      `${window.location.origin}/input-prompts/keyboard_w_outline.svg`,
    );
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
    expect(createAbsolutePublicAssetUrl("input-prompts/keyboard_w_outline.svg")).toBe(
      `${window.location.origin}/nested/prefix/v3/input-prompts/keyboard_w_outline.svg`,
    );
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
