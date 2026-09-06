import { BufferImageSource, Texture } from "pixi.js";
import { describe, expect, it, vi } from "vitest";

import type { DeviceSpriteAnimationDefinition } from "@/domain/registry";
import { DeviceAnimationTextureCache } from "@/renderer/texture/device-animation-textures";
import { isFallbackTexture } from "@/renderer/texture";
import { normalizeDeviceSpriteAnimationDefinition, resolveDeviceSpriteAnimationGrid } from "@/shared/device-sprite-animation";

const definition: DeviceSpriteAnimationDefinition = {
  clips: {
    open: { rows: 2, columns: 2 },
    open_idle: { rows: 2, columns: 2 },
    close: { rows: 2, columns: 2 },
    close_idle: { rows: 2, columns: 2 },
  },
  closeIdleMode: "loop",
};

function createTexture(width: number, height: number): Texture {
  return new Texture({ source: new BufferImageSource({
    resource: new Uint8Array(width * height * 4), width, height,
  }) });
}

function createCache(options: { failName?: string; width?: number; maxSize?: number } = {}) {
  const sources: Texture[] = [];
  const requests: string[] = [];
  const configured: Texture[] = [];
  const cache = new DeviceAnimationTextureCache({
    loadTexture: async (path) => {
      requests.push(path);
      if (path.endsWith(`/${options.failName}.webp`)) throw new Error("missing asset");
      const texture = path.endsWith("/mask.webp") ? createTexture(2, 2) : createTexture(options.width ?? 4, 4);
      sources.push(texture);
      return texture;
    },
    configureTexture: (texture) => { configured.push(texture); },
    getMaxTextureSize: () => options.maxSize ?? 4096,
  });
  return { cache, sources, requests, configured, dispose: () => {
    cache.destroy();
    for (const source of sources) source.destroy(true);
  } };
}

describe("device animation textures", () => {
  it("does not classify a real 16 by 16 sprite as a missing resource", () => {
    const texture = createTexture(16, 16);
    try { expect(isFallbackTexture(texture)).toBe(false); }
    finally { texture.destroy(true); }
  });

  it("shares one in-flight request, row-major subtextures and the union mask", async () => {
    const context = createCache();
    try {
      const first = context.cache.get("fixture", definition);
      expect(context.cache.get("fixture", definition)).toBe(first);
      const animation = await first;
      expect(animation).not.toBeNull();
      expect(context.requests).toHaveLength(5);
      expect(context.configured).toHaveLength(5);
      expect(animation!.clips.open.map((texture) => ({
        x: texture.frame.x, y: texture.frame.y, width: texture.width, height: texture.height,
      }))).toEqual([
        { x: 0, y: 0, width: 2, height: 2 }, { x: 2, y: 0, width: 2, height: 2 },
        { x: 0, y: 2, width: 2, height: 2 }, { x: 2, y: 2, width: 2, height: 2 },
      ]);
      expect(animation!.clips.open.every((frame) => frame.source === context.sources[0]!.source)).toBe(true);
      expect(animation!.mask).toBe(context.sources[4]);
      context.cache.destroy();
      expect(animation!.clips.open.every((frame) => frame.destroyed)).toBe(true);
      expect(context.sources.every((texture) => !texture.destroyed && !texture.source.destroyed)).toBe(true);
    } finally { context.dispose(); }
  });

  for (const failName of ["open", "close_idle", "mask"]) {
    it(`falls back atomically and caches failure when ${failName} fails`, async () => {
      const context = createCache({ failName });
      const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        expect(await context.cache.get("fixture", definition)).toBeNull();
        expect(await context.cache.get("fixture", definition)).toBeNull();
        expect(context.requests).toHaveLength(5);
        expect(context.configured).toHaveLength(0);
        expect(errors).toHaveBeenCalledTimes(1);
      } finally { context.dispose(); errors.mockRestore(); }
    });
  }

  it("rejects contradictory metadata for one spriteId without reloading", async () => {
    const context = createCache();
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await context.cache.get("fixture", definition)).not.toBeNull();
      expect(await context.cache.get("fixture", { ...definition, closeIdleMode: "hold-last" })).toBeNull();
      expect(context.requests).toHaveLength(5);
    } finally { context.dispose(); errors.mockRestore(); }
  });

  it("does not publish or configure textures which finish after destruction", async () => {
    const source = createTexture(4, 4);
    let finish!: (texture: Texture) => void;
    const pending = new Promise<Texture>((resolve) => { finish = resolve; });
    let configured = 0;
    const cache = new DeviceAnimationTextureCache({
      loadTexture: () => pending,
      configureTexture: () => { configured += 1; },
      getMaxTextureSize: () => 4096,
    });
    const result = cache.get("fixture", definition);
    cache.destroy();
    finish(source);
    expect(await result).toBeNull();
    expect(await cache.get("fixture", definition)).toBeNull();
    expect(configured).toBe(0);
    expect(source.destroyed).toBe(false);
    source.destroy(true);
  });

  it("rejects an atlas exceeding the actual GPU limit before configuring textures", async () => {
    const context = createCache({ maxSize: 2 });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await context.cache.get("fixture", definition)).toBeNull();
      expect(context.configured).toHaveLength(0);
    } finally { context.dispose(); errors.mockRestore(); }
  });

  it("checks divisible and identical per-frame dimensions", () => {
    const normalized = normalizeDeviceSpriteAnimationDefinition(definition);
    const dimensions = { open: { width: 4, height: 4 }, open_idle: { width: 4, height: 4 },
      close: { width: 4, height: 4 }, close_idle: { width: 4, height: 4 } };
    expect(resolveDeviceSpriteAnimationGrid(normalized, dimensions)).toEqual({ frameWidth: 2, frameHeight: 2 });
    expect(() => resolveDeviceSpriteAnimationGrid(normalized, { ...dimensions, close: { width: 3, height: 4 } }))
      .toThrow("divide evenly");
    expect(() => resolveDeviceSpriteAnimationGrid(normalized, { ...dimensions, close: { width: 8, height: 4 } }))
      .toThrow("differ");
  });
});
