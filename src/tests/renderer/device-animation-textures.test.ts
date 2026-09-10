import { BufferImageSource, Texture } from "pixi.js";
import { describe, expect, it, vi } from "vitest";

import type { DeviceSpriteAnimationDefinition } from "@/domain/registry";
import { DeviceAnimationTextureCache } from "@/renderer/texture/device-animation-textures";
import { isFallbackTexture } from "@/renderer/texture";
import {
  DEVICE_SPRITE_ANIMATION_PHASES,
  normalizeDeviceSpriteAnimationDefinition,
  resolveDeviceSpriteAnimationFrame,
  resolveDeviceSpriteAnimationGrid,
} from "@/shared/device-sprite-animation";

const definition: DeviceSpriteAnimationDefinition = {
  closeIdleMode: "loop",
};

const manifest = {
  schemaVersion: 1,
  frameWidth: 2,
  frameHeight: 2,
  maskFile: "mask.webp",
  clips: {
    open: {
      frameCount: 3,
      frameDurationMs: 100,
      pages: [
        { file: "open-0.webp", rows: 1, columns: 2, frameCount: 2 },
        { file: "open-1.webp", rows: 1, columns: 2, frameCount: 1 },
      ],
    },
    open_idle: {
      frameCount: 2,
      frameDurationMs: 100,
      pages: [{ file: "open_idle-0.webp", rows: 1, columns: 2, frameCount: 2 }],
    },
    close: {
      frameCount: 2,
      frameDurationMs: 100,
      pages: [{ file: "close-0.webp", rows: 1, columns: 2, frameCount: 2 }],
    },
    close_idle: {
      frameCount: 1,
      frameDurationMs: 100,
      pages: [{ file: "close_idle-0.webp", rows: 1, columns: 1, frameCount: 1 }],
    },
  },
};

function createTexture(width: number, height: number): Texture {
  return new Texture({ source: new BufferImageSource({
    resource: new Uint8Array(width * height * 4), width, height,
  }) });
}

function createCache(options: { failName?: string; maxSize?: number } = {}) {
  const sources: Texture[] = [];
  const requests: string[] = [];
  const unloads: string[] = [];
  const configured: Texture[] = [];
  const cache = new DeviceAnimationTextureCache({
    loadManifest: async (path) => {
      requests.push(path);
      return manifest;
    },
    loadTexture: async (path) => {
      requests.push(path);
      if (path.endsWith(`/${options.failName}`)) throw new Error("missing asset");
      const file = path.split("/").at(-1);
      const page = Object.values(manifest.clips).flatMap((clip) => clip.pages)
        .find((candidate) => candidate.file === file);
      const texture = file === "mask.webp"
        ? createTexture(2, 2)
        : createTexture(page!.columns * 2, page!.rows * 2);
      sources.push(texture);
      return texture;
    },
    unloadTexture: async (path, texture) => {
      unloads.push(path);
      if (!texture.destroyed) texture.destroy(true);
    },
    configureTexture: (texture) => { configured.push(texture); },
    getMaxTextureSize: () => options.maxSize ?? 4096,
  });
  return {
    cache,
    sources,
    requests,
    unloads,
    configured,
    dispose: () => {
      cache.destroy();
      for (const source of sources) {
        if (!source.destroyed) source.destroy(true);
      }
    },
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("device animation textures", () => {
  it("does not classify a real 16 by 16 sprite as a missing resource", () => {
    const texture = createTexture(16, 16);
    try { expect(isFallbackTexture(texture)).toBe(false); }
    finally { texture.destroy(true); }
  });

  it("loads manifest and mask once, then shares retained pages across sessions", async () => {
    const context = createCache();
    try {
      const first = await context.cache.get("fixture", definition);
      const second = await context.cache.get("fixture", definition);
      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(first).not.toBe(second);
      expect(context.requests).toEqual([
        "/3d-top-view/animations/fixture/manifest.json",
        "/3d-top-view/animations/fixture/mask.webp",
      ]);

      const firstTexture = await first!.prepareFrame("open", 0);
      const secondTexture = await second!.prepareFrame("open", 0);
      await flushMicrotasks();
      expect(firstTexture).not.toBeNull();
      expect(secondTexture).toBe(firstTexture);
      expect(context.requests.filter((path) => path.endsWith("open-0.webp"))).toHaveLength(1);
      expect(context.requests.filter((path) => path.endsWith("open-1.webp"))).toHaveLength(1);
      expect(context.cache.getStats()).toMatchObject({
        activeSessions: 2,
        residentMasks: 1,
        residentPages: 2,
        residentDecodedBytes: 80,
      });

      first!.commitFrame("open", 0);
      second!.commitFrame("open", 0);
      first!.destroy();
      await flushMicrotasks();
      expect(context.unloads.some((path) => path.endsWith("open-0.webp"))).toBe(false);
      second!.destroy();
      await flushMicrotasks();
      expect(context.unloads.some((path) => path.endsWith("open-0.webp"))).toBe(true);
      expect(context.unloads.some((path) => path.endsWith("open-1.webp"))).toBe(true);
    } finally { context.dispose(); }
  });

  it("maps effective frames across pages and never creates a trailing blank frame", async () => {
    const context = createCache();
    try {
      const animation = await context.cache.get("fixture", definition);
      expect(await animation!.prepareFrame("open", 2)).not.toBeNull();
      const texture = animation!.commitFrame("open", 2);
      expect(texture).toMatchObject({
        frame: { x: 0, y: 0, width: 2, height: 2 },
      });
      expect(() => resolveDeviceSpriteAnimationFrame(animation!.definition, "open", 3)).toThrow("out of range");
      animation!.destroy();
    } finally { context.dispose(); }
  });

  it("rejects contradictory metadata for one spriteId without reloading", async () => {
    const context = createCache();
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const animation = await context.cache.get("fixture", definition);
      expect(animation).not.toBeNull();
      expect(await context.cache.get("fixture", { closeIdleMode: "hold-last" })).toBeNull();
      expect(context.requests).toEqual([
        "/3d-top-view/animations/fixture/manifest.json",
        "/3d-top-view/animations/fixture/mask.webp",
      ]);
      animation!.destroy();
    } finally {
      context.dispose();
      errors.mockRestore();
    }
  });

  it("does not publish or configure textures which finish after destruction", async () => {
    const mask = createTexture(2, 2);
    let finish!: (texture: Texture) => void;
    const pending = new Promise<Texture>((resolve) => { finish = resolve; });
    let configured = 0;
    let unloaded = 0;
    const cache = new DeviceAnimationTextureCache({
      loadManifest: async () => manifest,
      loadTexture: () => pending,
      unloadTexture: async (_path, texture) => {
        unloaded += 1;
        texture.destroy(true);
      },
      configureTexture: () => { configured += 1; },
      getMaxTextureSize: () => 4096,
    });
    const result = cache.get("fixture", definition);
    await flushMicrotasks();
    cache.destroy();
    finish(mask);
    expect(await result).toBeNull();
    expect(await cache.get("fixture", definition)).toBeNull();
    expect(configured).toBe(0);
    expect(unloaded).toBe(1);
  });

  it("atomically rejects an invalid manifest or a missing page", async () => {
    const invalidManifestCache = new DeviceAnimationTextureCache({
      loadManifest: async () => ({
        ...manifest,
        clips: {
          ...manifest.clips,
          open: { ...manifest.clips.open, frameCount: 4 },
        },
      }),
      loadTexture: async () => createTexture(2, 2),
      unloadTexture: async (_path, texture) => { texture.destroy(true); },
      configureTexture: () => undefined,
      getMaxTextureSize: () => 4096,
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await invalidManifestCache.get("invalid", definition)).toBeNull();
      const missingPageContext = createCache({ failName: "open-0.webp" });
      try {
        const animation = await missingPageContext.cache.get("missing", definition);
        expect(animation).not.toBeNull();
        expect(await animation!.prepareFrame("open", 0)).toBeNull();
      } finally {
        missingPageContext.dispose();
      }
    } finally {
      invalidManifestCache.destroy();
      errors.mockRestore();
    }
  });

  it("caches mask load failure without retrying the asset", async () => {
    const context = createCache({ failName: "mask.webp" });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await context.cache.get("missing-mask", definition)).toBeNull();
      expect(await context.cache.get("missing-mask", definition)).toBeNull();
      expect(context.requests).toEqual([
        "/3d-top-view/animations/missing-mask/manifest.json",
        "/3d-top-view/animations/missing-mask/mask.webp",
      ]);
      expect(errors).toHaveBeenCalledTimes(1);
    } finally {
      context.dispose();
      errors.mockRestore();
    }
  });

  it("caches a non-initial page failure as an atomic animation failure", async () => {
    const context = createCache({ failName: "close_idle-0.webp" });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const animation = await context.cache.get("missing-close-idle", definition);
      expect(animation).not.toBeNull();
      expect(await animation!.prepareFrame("close_idle", 0)).toBeNull();
      expect(await context.cache.get("missing-close-idle", definition)).toBeNull();
      expect(context.requests.filter((path) => path.endsWith("close_idle-0.webp"))).toHaveLength(1);
      animation!.destroy();
    } finally {
      context.dispose();
      errors.mockRestore();
    }
  });

  it("rejects a page at or above the runtime texture limit", async () => {
    const context = createCache({ maxSize: 4 });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const animation = await context.cache.get("fixture", definition);
      expect(animation).not.toBeNull();
      expect(await animation!.prepareFrame("open", 0)).toBeNull();
      expect(context.configured).toHaveLength(1);
    } finally {
      context.dispose();
      errors.mockRestore();
    }
  });

  it("checks manifest page dimensions against the common frame size", () => {
    const normalized = normalizeDeviceSpriteAnimationDefinition(definition, manifest);
    const page = normalized.clips.open.pages[0]!;
    expect(resolveDeviceSpriteAnimationGrid(normalized, page, { width: 4, height: 2 }))
      .toEqual({ frameWidth: 2, frameHeight: 2 });
    expect(() => resolveDeviceSpriteAnimationGrid(normalized, page, { width: 3, height: 2 }))
      .toThrow("differ");
  });

  it.each(DEVICE_SPRITE_ANIMATION_PHASES)("rejects %s with an invalid page grid", (phase) => {
    const invalidManifest = {
      ...manifest,
      clips: {
        ...manifest.clips,
        [phase]: {
          ...manifest.clips[phase],
          pages: [{ ...manifest.clips[phase].pages[0], rows: 0 }],
        },
      },
    };
    expect(() => normalizeDeviceSpriteAnimationDefinition(definition, invalidManifest)).toThrow();
  });

  it.each([
    { rows: -1 },
    { rows: 1.5 },
    { rows: Number.NaN },
    { rows: Number.MAX_SAFE_INTEGER + 1 },
    { columns: 0 },
    { columns: 1.5 },
    { columns: Number.POSITIVE_INFINITY },
    { rows: Number.MAX_SAFE_INTEGER, columns: 2 },
    { frameCount: 0 },
    { frameCount: -1 },
    { frameCount: 3 },
  ])("rejects an uncomputable page declaration $rows x $columns / $frameCount", (pagePatch) => {
    const invalidManifest = {
      ...manifest,
      clips: {
        ...manifest.clips,
        open: {
          ...manifest.clips.open,
          pages: [{ ...manifest.clips.open.pages[0], ...pagePatch }, manifest.clips.open.pages[1]],
        },
      },
    };
    expect(() => normalizeDeviceSpriteAnimationDefinition(definition, invalidManifest)).toThrow();
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_VALUE])(
    "rejects an invalid frame duration %s",
    (frameDurationMs) => {
      const invalidManifest = {
        ...manifest,
        clips: {
          ...manifest.clips,
          open: { ...manifest.clips.open, frameDurationMs },
        },
      };
      expect(() => normalizeDeviceSpriteAnimationDefinition(definition, invalidManifest)).toThrow();
    },
  );

  it.each([
    [], [30, 40], [30, 0, 40], [30, -1, 40], [30, Number.NaN, 40],
    [30, Number.POSITIVE_INFINITY, 40], [Number.MAX_SAFE_INTEGER, 30, 40],
  ])("rejects invalid per-frame durations %j", (...frameDurationsMs) => {
    expect(() => normalizeDeviceSpriteAnimationDefinition(definition, {
      ...manifest,
      clips: { ...manifest.clips, open: { ...manifest.clips.open, frameDurationsMs } },
    })).toThrow();
  });

  it("rejects a missing phase and an unknown close idle strategy", () => {
    const clipsWithoutClose = {
      open: manifest.clips.open,
      open_idle: manifest.clips.open_idle,
      close_idle: manifest.clips.close_idle,
    };
    expect(() => normalizeDeviceSpriteAnimationDefinition(definition, {
      ...manifest,
      clips: clipsWithoutClose,
    })).toThrow();
    expect(() => normalizeDeviceSpriteAnimationDefinition({ closeIdleMode: "ping-pong" }, manifest))
      .toThrow();
  });
});
