import { Assets, loadTextures } from "pixi.js";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { loadDeviceAnimationTexture } from "@/renderer/texture/device-animation-texture-loader";

const loadedPaths = new Set<string>();
const preferWorkers = loadTextures.config!.preferWorkers;
let nextPath = 0;

beforeAll(async () => {
  // 使用真实 Assets/Texture；仅替代 jsdom 缺失的网络与位图解码边界。
  loadTextures.config!.preferWorkers = false;
  await Assets.init({ skipDetections: true });
});

afterEach(async () => {
  for (const path of loadedPaths) await Assets.unload(path);
  loadedPaths.clear();
  vi.unstubAllGlobals();
});

afterAll(() => { loadTextures.config!.preferWorkers = preferWorkers; });

// AI-REMOVED 2026-09-13:
// Reason: 运行时缩放已退出活动实现，原缩放断言不再代表需求。
// Trigger: 用户授权离线生成半尺寸素材。
// Evidence: 新加载入口直接解码发布图片，分辨率来自 manifest。
// Replacement: 下方 published animation texture loading 测试。
// Risk: Low；保留真实 Assets 缓存与卸载验证。Human Review: Required
// Original code:
// function prepareBitmaps(options: { width?: number; resizeError?: Error; wrongSize?: boolean } = {}) {
//   const original = { width: options.width ?? 8, height: 4, close: vi.fn() };
//   const resized = { width: options.wrongSize ? 8 : 4, height: 2, close: vi.fn() };
//   const blob = new Blob(["fixture"], { type: "image/webp" });
//   const decode = vi.fn(async (input: unknown) => {
//     if (input === blob) return original;
//     if (options.resizeError) throw options.resizeError;
//     return resized;
//   });
//   const fetch = vi.fn(async () => ({ ok: true, blob: async () => blob }));
//   vi.stubGlobal("fetch", fetch);
//   vi.stubGlobal("createImageBitmap", decode);
//   const path = `/3d-top-view/animations/fixture/half-${nextPath++}.webp`;
//   return { original, resized, decode, fetch, path };
// }
//
// describe("half-resolution animation texture loading", () => {
//   it("shares decoding and resizing, preserves logical size, and closes both bitmap lifetimes", async () => {
//     const context = prepareBitmaps();
//     const first = loadDeviceAnimationTexture(context.path);
//     const second = loadDeviceAnimationTexture(context.path);
//     const [texture, shared] = await Promise.all([first, second]);
//     loadedPaths.add(context.path);
//     expect(shared).toBe(texture);
//     expect(context.fetch).toHaveBeenCalledTimes(1);
//     expect(context.decode).toHaveBeenCalledTimes(2);
//     expect(context.decode).toHaveBeenLastCalledWith(context.original, {
//       resizeWidth: 4, resizeHeight: 2, resizeQuality: "high", premultiplyAlpha: "premultiply",
//     });
//     expect(texture).toMatchObject({
//       width: 8, height: 4,
//       source: {
//         pixelWidth: 4, pixelHeight: 2, resolution: 0.5,
//         resource: context.resized, alphaMode: "premultiplied-alpha",
//       },
//     });
//     expect(context.original.close).toHaveBeenCalledTimes(1);
//     expect(context.resized.close).not.toHaveBeenCalled();
//     await Assets.unload(context.path);
//     loadedPaths.delete(context.path);
//     expect(texture.destroyed).toBe(true);
//     expect(context.resized.close).toHaveBeenCalledTimes(1);
//
//     const reloaded = await loadDeviceAnimationTexture(context.path);
//     loadedPaths.add(context.path);
//     expect(reloaded).not.toBe(texture);
//     expect(context.fetch).toHaveBeenCalledTimes(2);
//   });
//
//   it("releases the original bitmap when resizing rejects", async () => {
//     const context = prepareBitmaps({ resizeError: new Error("resize failed") });
//     await expect(loadDeviceAnimationTexture(context.path)).rejects.toThrow("resize failed");
//     expect(context.original.close).toHaveBeenCalledTimes(1);
//     expect(context.resized.close).not.toHaveBeenCalled();
//   });
//
//   it("rejects unsupported resize output and releases both bitmaps", async () => {
//     const context = prepareBitmaps({ wrongSize: true });
//     await expect(loadDeviceAnimationTexture(context.path)).rejects.toThrow("resize dimensions differ");
//     expect(context.original.close).toHaveBeenCalledTimes(1);
//     expect(context.resized.close).toHaveBeenCalledTimes(1);
//   });
//
//   it("rejects odd dimensions instead of shifting frame coordinates through rounding", async () => {
//     const context = prepareBitmaps({ width: 7 });
//     await expect(loadDeviceAnimationTexture(context.path)).rejects.toThrow("positive and even");
//     expect(context.decode).toHaveBeenCalledTimes(1);
//     expect(context.original.close).toHaveBeenCalledTimes(1);
//   });
// });

function preparePublishedBitmap(options: { decodeError?: Error } = {}) {
  const bitmap = { width: 3, height: 2, close: vi.fn() };
  const blob = new Blob(["fixture"], { type: "image/webp" });
  const decode = vi.fn(async () => {
    if (options.decodeError) throw options.decodeError;
    return bitmap;
  });
  const fetch = vi.fn(async () => ({ ok: true, blob: async () => blob }));
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("createImageBitmap", decode);
  return { bitmap, blob, decode, fetch, path: `/3d-top-view/animations/fixture/published-${nextPath++}.webp` };
}

describe("published animation texture loading", () => {
  it.each([0.5, 1])("只解码一次，按清单恢复逻辑尺寸，共享缓存并在卸载时关闭位图：%s", async (resolution) => {
    const context = preparePublishedBitmap();
    const [texture, shared] = await Promise.all([
      loadDeviceAnimationTexture(context.path, resolution),
      loadDeviceAnimationTexture(context.path, resolution),
    ]);
    loadedPaths.add(context.path);
    expect(shared).toBe(texture);
    expect(context.fetch).toHaveBeenCalledTimes(1);
    expect(context.decode).toHaveBeenCalledExactlyOnceWith(context.blob);
    expect(texture).toMatchObject({
      width: 3 / resolution, height: 2 / resolution,
      source: { pixelWidth: 3, pixelHeight: 2, resolution,
        resource: context.bitmap, alphaMode: "premultiplied-alpha" },
    });
    expect(context.bitmap.close).not.toHaveBeenCalled();
    await Assets.unload(context.path);
    loadedPaths.delete(context.path);
    expect(texture.destroyed).toBe(true);
    expect(context.bitmap.close).toHaveBeenCalledTimes(1);
    const reloaded = await loadDeviceAnimationTexture(context.path, resolution);
    loadedPaths.add(context.path);
    expect(reloaded).not.toBe(texture);
    expect(context.decode).toHaveBeenCalledTimes(2);
  });

  it("传播解码错误，不尝试缩放或创建第二份位图", async () => {
    const context = preparePublishedBitmap({ decodeError: new Error("decode failed") });
    await expect(loadDeviceAnimationTexture(context.path, 0.5)).rejects.toThrow("decode failed");
    expect(context.decode).toHaveBeenCalledExactlyOnceWith(context.blob);
    expect(context.bitmap.close).not.toHaveBeenCalled();
  });

  it.each([0, -1, 2, Number.NaN, Number.POSITIVE_INFINITY])("在请求图片前拒绝无效分辨率：%s", async (resolution) => {
    const context = preparePublishedBitmap();
    await expect(loadDeviceAnimationTexture(context.path, resolution)).rejects.toThrow("valid resolution");
    expect(context.fetch).not.toHaveBeenCalled();
  });
});
