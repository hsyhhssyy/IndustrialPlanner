import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDeviceIconAssetUrl,
  createItemIconAssetUrl,
  createPublicAssetUrl,
  isRootPublicAssetBaseUrl,
} from "@/shared/browser/public-asset-url";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("public asset url", () => {
  it("keeps public assets relative when Vite base is relative", () => {
    vi.stubEnv("BASE_URL", "./");

    expect(createPublicAssetUrl("help/getting-started.md")).toBe("./help/getting-started.md");
    expect(createPublicAssetUrl("/textures/scanline-45deg-50opacity.png")).toBe("./textures/scanline-45deg-50opacity.png");
    expect(createDeviceIconAssetUrl("item_log_belt_01")).toBe("./device-icons/item_log_belt_01.webp");
    expect(createItemIconAssetUrl("item_iron_ore")).toBe("./item-icons/item_iron_ore.webp");
    expect(createPublicAssetUrl("https://example.com/static.png")).toBe("https://example.com/static.png");
    expect(isRootPublicAssetBaseUrl()).toBe(false);
  });

  it("normalizes public assets for root and nested absolute bases", () => {
    vi.stubEnv("BASE_URL", "/");
    expect(createPublicAssetUrl("help/getting-started.md")).toBe("/help/getting-started.md");
    expect(createPublicAssetUrl("../v2/")).toBe("/v2/");
    expect(isRootPublicAssetBaseUrl()).toBe(true);

    vi.stubEnv("BASE_URL", "/nested/prefix/v3/");
    expect(createPublicAssetUrl("help/getting-started.md")).toBe("/nested/prefix/v3/help/getting-started.md");
    expect(createPublicAssetUrl("../v2/")).toBe("/nested/prefix/v2/");
    expect(isRootPublicAssetBaseUrl()).toBe(false);
  });
});
