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
  schemaVersion: 2,
  frameWidth: 2,
  frameHeight: 2,
  maskFile: "mask.webp",
  playback: {
    fallbackClip: "close_idle",
    staticClip: "open",
    statusClips: { normal: "open_idle" },
    openTransitionClip: "open",
    closeTransitionClip: "close",
  },
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

function createTexture(width: number, height: number, resolution = 1): Texture {
  return new Texture({ source: new BufferImageSource({
    resource: new Uint8Array(width * height * resolution * resolution * 4), width, height, resolution,
  }) });
}

function createCache(options: {
  // AI-REMOVED 2026-09-13:
  // Reason: 测试契约从预算选择/即时回收改为全量驻留与 20 秒离屏期限。
  // Trigger: 用户明确调整动画驻留规则，执行测试前同步原行为断言。
  // Evidence: DeviceAnimationTextureCache 已取消预算与 5 秒回收。
  // Replacement: 下方测试加载器选项
  // Risk: Low; Human Review: Required
  // Original code:
  // failName?: string; maxSize?: number; resolution?: number; budgetBytes?: number;
  failName?: string; maxSize?: number; resolution?: number;
  uploadFailName?: string; beforeLoad?: (path: string) => Promise<void>;
  sharedAnimationId?: string;
} = {}) {
  const sources: Texture[] = [];
  const requests: string[] = [];
  const unloads: string[] = [];
  const configured: Texture[] = [];
  const uploads: string[] = [];
  const cache = new DeviceAnimationTextureCache({
    // AI-REMOVED 2026-09-13:
    // Reason: 测试契约从预算选择/即时回收改为全量驻留与 20 秒离屏期限。
    // Trigger: 用户明确调整动画驻留规则，执行测试前同步原行为断言。
    // Evidence: DeviceAnimationTextureCache 已取消预算与 5 秒回收。
    // Replacement: 缓存默认全量驻留，无预算输入
    // Risk: Low; Human Review: Required
    // Original code:
    // budgetBytes: options.budgetBytes,
    uploadTexture: (texture) => {
      uploads.push(texture.source.label);
      if (texture.source.label.endsWith(`/${options.uploadFailName}`)) throw new Error("GPU upload failed");
    },
    loadManifest: async (path) => {
      requests.push(path);
      return { ...manifest, resolution: options.resolution ?? 1,
        ...(options.sharedAnimationId && path.includes("/variant/")
          ? { sharedAnimationId: options.sharedAnimationId } : {}) };
    },
    loadTexture: async (path, resolution) => {
      requests.push(path);
      if (options.beforeLoad !== undefined) await options.beforeLoad(path);
      if (path.endsWith(`/${options.failName}`)) throw new Error("missing asset");
      const file = path.split("/").at(-1);
      const page = Object.values(manifest.clips).flatMap((clip) => clip.pages)
        .find((candidate) => candidate.file === file);
      const texture = file === "mask.webp"
        ? createTexture(2, 2, resolution)
        : createTexture(page!.columns * 2, page!.rows * 2, resolution);
      texture.source.label = path;
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
    uploads,
    dispose: () => {
      cache.destroy();
      for (const source of sources) {
        if (!source.destroyed) source.destroy(true);
      }
    },
  };
}

async function waitForPreparedPages(cache: DeviceAnimationTextureCache): Promise<void> {
  await vi.waitFor(() => {
    expect(cache.getStats().loadingPages).toBe(0);
    expect(cache.getStats().residency.queuedPages).toBe(0);
  }, { interval: 5, timeout: 1000 });
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("device animation textures", () => {

  it("变体清单引用基础动画时共用页面、遮罩及驻留生命周期", async () => {
    const context = createCache({ sharedAnimationId: "base" });
    try {
      const variant = (await context.cache.get("variant", definition))!;
      const base = (await context.cache.get("base", definition))!;
      variant.setVisible(true);
      base.setVisible(true);
      await flushMicrotasks();
      await waitForPreparedPages(context.cache);
      expect(variant.mask).toBe(base.mask);
      expect(context.cache.getStats().residency).toMatchObject({
        visibleSessions: 2, visibleAssets: 1,
        assets: [{ spriteId: "base", visibleInstances: 2 }],
      });
      expect(context.requests.filter((path) => path.endsWith("/mask.webp"))).toEqual([
        expect.stringContaining("/base/mask.webp"),
      ]);
      expect(context.requests.some((path) => path.includes("/variant/") && path.endsWith(".webp"))).toBe(false);
      const frame = base.commitFrame("open", 0)!;
      variant.destroy();
      await flushMicrotasks();
      expect(base.commitFrame("open", 0)).toBe(frame);
      expect(frame.source.destroyed).toBe(false);
      expect(context.unloads).toHaveLength(0);
    } finally { context.dispose(); }
  });

  it("在尚未播放时预上传可见类型的全部阶段，同类实例共享且切换不重复上传", async () => {
    const context = createCache();
    try {
      const first = (await context.cache.get("warm", definition))!;
      const second = (await context.cache.get("warm", definition))!;
      first.setVisible(true);
      second.setVisible(true);
      await flushMicrotasks();
      await waitForPreparedPages(context.cache);
      expect(context.uploads).toHaveLength(5);
      expect(new Set(context.uploads).size).toBe(5);
      expect(context.cache.getStats().residency).toMatchObject({
        visibleSessions: 2, visibleAssets: 1,
        assets: [{ spriteId: "warm", visibleInstances: 2, selectedPages: 5, preparedPages: 5, totalPages: 5, totalFrames: 8, preparedFrames: 8, totalSetBytes: 144 }],
      });
      const initial = first.commitFrame("open", 0)!;
      for (let loop = 0; loop < 3; loop++) {
        for (const phase of DEVICE_SPRITE_ANIMATION_PHASES) {
          expect(await first.prepareFrame(phase, 0)).not.toBeNull();
          expect(first.commitFrame(phase, 0)).not.toBeNull();
          await flushMicrotasks();
        }
      }
      expect(initial.source.autoGarbageCollect).toBe(false);
      expect(initial.source.destroyed).toBe(false);
      expect(context.uploads).toHaveLength(5);
      expect(context.unloads).toHaveLength(0);
    } finally { context.dispose(); }
  });

  it("优先预热每个阶段的入口，再加载过渡动画的后续页", async () => {
    const context = createCache();
    try {
      const animation = (await context.cache.get("priority", definition))!;
      animation.setVisible(true);
      await flushMicrotasks();
      await waitForPreparedPages(context.cache);
      expect(context.uploads.slice(0, 4).map(path => path.split("/").at(-1))).toEqual([
        "open-0.webp", "open_idle-0.webp", "close-0.webp", "close_idle-0.webp",
      ]);
      expect(context.uploads[4]).toMatch(/open-1.webp$/);
    } finally { context.dispose(); }
  });

  it("同一轮连续切换阶段后，旧微任务不能释放重新领取的当前页", async () => {
    const context = createCache();
    try {
      const animation = (await context.cache.get("reacquire", definition))!;
      const frame = (await animation.prepareFrame("open", 0))!;
      await animation.prepareFrame("close", 0);
      await waitForPreparedPages(context.cache);
      animation.commitFrame("open", 0);
      animation.commitFrame("close", 0);
      animation.commitFrame("open", 0);
      await flushMicrotasks();
      expect(frame.destroyed).toBe(false);
      expect(frame.source.destroyed).toBe(false);
      expect(animation.commitFrame("open", 0)).toBe(frame);
      expect(context.cache.getStats().residentPages).toBe(5);
    } finally { context.dispose(); }
  });

  // AI-REMOVED 2026-09-13:
  // Reason: 测试契约从预算选择/即时回收改为全量驻留与 20 秒离屏期限。
  // Trigger: 用户明确调整动画驻留规则，执行测试前同步原行为断言。
  // Evidence: DeviceAnimationTextureCache 已取消预算与 5 秒回收。
  // Replacement: 任一阶段首次请求都触发全部页面与全部帧测试
  // Risk: Low; Human Review: Required
  // Original code:
  // it("预算不足时限制推测预热，保护当前与相邻页并报告超出软预算", async () => {
  //   const context = createCache({ budgetBytes: 40 });
  //   try {
  //     const animation = (await context.cache.get("budget", definition))!;
  //     animation.setVisible(true);
  //     const frame = await animation.prepareFrame("open", 0);
  //     await waitForPreparedPages(context.cache);
  //     expect(frame).not.toBeNull();
  //     expect(animation.commitFrame("open", 0)).toBe(frame);
  //     expect(context.uploads).toHaveLength(2);
  //     expect(context.cache.getStats().residency).toMatchObject({ budgetBytes: 40, reservedBytes: 80, overBudgetBytes: 40 });
  //     expect(frame!.source.destroyed).toBe(false);
  //     expect(context.unloads).toHaveLength(0);
  //   } finally { context.dispose(); }
  // });

  it.each(DEVICE_SPRITE_ANIMATION_PHASES)("首次只请求 %s 也加载全部阶段全部帧，长时间停留不回收", async (firstPhase) => {
    vi.useFakeTimers();
    const context = createCache();
    try {
      const animation = (await context.cache.get("all-phases", definition))!;
      const preparing = animation.prepareFrame(firstPhase, 0);
      await vi.advanceTimersByTimeAsync(200);
      expect(await preparing).not.toBeNull();
      const frames: Texture[] = [];
      for (const phase of DEVICE_SPRITE_ANIMATION_PHASES) {
        for (let index = 0; index < manifest.clips[phase].frameCount; index++) {
          expect(animation.hasFrame(phase, index)).toBe(true);
          frames.push(animation.commitFrame(phase, index)!);
        }
      }
      expect(frames).toHaveLength(8);
      expect(new Set(frames.map(frame => frame.source)).size).toBe(5);
      expect(context.cache.getStats().residency).toMatchObject({
        mode: "full-set", offscreenGraceMs: 20_000, retainedSetBytes: 144, retainedAssets: 1,
        assets: [{ selectedPages: 5, totalPages: 5, preparedPages: 5, totalFrames: 8, preparedFrames: 8, failedPages: 0, graceRemainingMs: null }],
      });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(context.uploads).toHaveLength(5);
      expect(context.unloads).toHaveLength(0);
      for (const frame of frames) {
        expect(frame.destroyed).toBe(false);
        expect(frame.source.destroyed).toBe(false);
        expect(frame.source.autoGarbageCollect).toBe(false);
      }
      animation.setVisible(false);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(frames.every(frame => !frame.destroyed)).toBe(true);
      expect(context.cache.getStats().residency.assets[0]!.graceRemainingMs).toBe(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(frames.every(frame => frame.destroyed)).toBe(true);
      expect(context.cache.getStats().residentPages).toBe(0);
    } finally { context.dispose(); vi.useRealTimers(); }
  });

  it("最后一个可见实例离屏后延迟回收，缓冲期重新进入视野不重载", async () => {
    vi.useFakeTimers();
    const context = createCache();
    try {
      const first = (await context.cache.get("grace", definition))!;
      const second = (await context.cache.get("grace", definition))!;
      first.setVisible(true);
      second.setVisible(true);
      await vi.advanceTimersByTimeAsync(200);
      expect(context.uploads).toHaveLength(5);
      first.setVisible(false);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(context.unloads).toHaveLength(0);
      second.setVisible(false);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(context.unloads).toHaveLength(0);
      first.setVisible(true);
      await vi.advanceTimersByTimeAsync(100);
      expect(context.uploads).toHaveLength(5);
      first.setVisible(false);
      await vi.advanceTimersByTimeAsync(20_001);
      expect(context.unloads).toHaveLength(5);
      expect(context.cache.getStats()).toMatchObject({ residentPages: 0, residency: { visibleAssets: 0, queuedPages: 0 } });
      expect(context.cache.getStats().residency.totalsSinceCreation.offscreenEvictions).toBe(5);
    } finally { context.dispose(); vi.useRealTimers(); }
  });

  it("快速移出视野仍继续完成整套预热，20 秒内保留未播放的全部帧", async () => {
    vi.useFakeTimers();
    const context = createCache();
    try {
      const animation = (await context.cache.get("grace-prewarm", definition))!;
      animation.setVisible(true);
      await flushMicrotasks();
      expect(context.cache.getStats().residency.queuedPages).toBe(5);
      animation.setVisible(false);
      await vi.advanceTimersByTimeAsync(200);
      expect(context.uploads).toHaveLength(5);
      expect(context.requests).toHaveLength(7);
      expect(context.unloads).toHaveLength(0);
      expect(context.cache.getStats().residency.assets[0]).toMatchObject({
        visibleInstances: 0, preparedPages: 5, preparedFrames: 8, graceRemainingMs: 19_800,
      });
      // 隐藏会话的迟到请求和重复隐藏不能刷新离屏期限或重新领取页面引用。
      expect(await animation.prepareFrame("open", 0)).toBeNull();
      animation.commitFrame("open", 0);
      animation.setVisible(false);
      await vi.advanceTimersByTimeAsync(19_801);
      expect(context.unloads).toHaveLength(5);
      expect(context.cache.getStats().residency.retainedAssets).toBe(0);
    } finally { context.dispose(); vi.useRealTimers(); }
  });

  it("不同类型分别计算最后离屏期限，销毁会话也保留已加载整套 20 秒", async () => {
    vi.useFakeTimers();
    const context = createCache();
    try {
      const first = (await context.cache.get("type-a", definition))!;
      const second = (await context.cache.get("type-b", definition))!;
      first.setVisible(true);
      second.setVisible(true);
      await vi.advanceTimersByTimeAsync(300);
      first.destroy();
      await vi.advanceTimersByTimeAsync(10_000);
      second.setVisible(false);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(context.unloads).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(context.unloads).toHaveLength(5);
      expect(context.unloads.every(path => path.includes("/type-a/"))).toBe(true);
      expect(context.cache.getStats()).toMatchObject({ residentPages: 5, residency: { retainedAssets: 1 } });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(context.unloads).toHaveLength(10);
    } finally { context.dispose(); vi.useRealTimers(); }
  });

  it("离屏超时取消剩余整套队列，迟到解码不上传；重入后完整重载", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const context = createCache({ beforeLoad: path => path.endsWith("open-0.webp") ? pending : Promise.resolve() });
    try {
      const animation = (await context.cache.get("expiry-loading", definition))!;
      const preparing = animation.prepareFrame("open", 0);
      await vi.advanceTimersByTimeAsync(20);
      animation.setVisible(false);
      await vi.advanceTimersByTimeAsync(20_001);
      expect(context.cache.getStats().residency.queuedPages).toBe(0);
      finish();
      expect(await preparing).toBeNull();
      expect(context.uploads).toHaveLength(0);
      expect(context.requests.filter(path => path.endsWith(".webp"))).toHaveLength(2);
      animation.setVisible(true);
      await vi.advanceTimersByTimeAsync(200);
      expect(context.uploads).toHaveLength(5);
      expect(context.cache.getStats().residency.assets[0]).toMatchObject({ totalFrames: 8, preparedFrames: 8 });
    } finally { finish(); context.dispose(); vi.useRealTimers(); }
  });

  it("缓存销毁时取消排队任务，正在解码的页面完成后释放且不上传", async () => {
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const context = createCache({ beforeLoad: path => path.endsWith("open-0.webp") ? pending : Promise.resolve() });
    try {
      const animation = (await context.cache.get("destroy-loading", definition))!;
      const preparing = animation.prepareFrame("open", 0);
      await vi.waitFor(() => expect(context.requests.some(path => path.endsWith("open-0.webp"))).toBe(true));
      context.cache.destroy();
      finish();
      expect(await preparing).toBeNull();
      expect(context.uploads).toHaveLength(0);
      expect(context.sources.every(texture => texture.destroyed)).toBe(true);
    } finally { finish(); context.dispose(); }
  });

  it("后台 GPU 预热失败不破坏当前帧，实际请求失败阶段时按原语义回退", async () => {
    const context = createCache({ uploadFailName: "close-0.webp" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const animation = (await context.cache.get("upload-failure", definition))!;
      animation.setVisible(true);
      const frame = await animation.prepareFrame("open", 0);
      await waitForPreparedPages(context.cache);
      expect(frame).not.toBeNull();
      expect(animation.commitFrame("open", 0)).toBe(frame);
      expect(context.cache.getStats().residency.totalsSinceCreation.prewarmFailures).toBe(1);
      expect(context.cache.getStats().residency.assets[0]).toMatchObject({
        totalPages: 5, preparedPages: 4, totalFrames: 8, preparedFrames: 6, failedPages: 1,
      });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(await animation.prepareFrame("close", 0)).toBeNull();
      expect(await context.cache.get("upload-failure", definition)).toBeNull();
    } finally { context.dispose(); warn.mockRestore(); }
  });


  it.each([0, -1, 2, Number.NaN, Number.POSITIVE_INFINITY, "0.5"])("rejects invalid manifest resolution %s", (resolution) => {
    expect(() => normalizeDeviceSpriteAnimationDefinition(definition, { ...manifest, resolution }))
      .toThrow("resolution");
  });

  it("rejects fractional published frame pixels before loading images", () => {
    expect(() => normalizeDeviceSpriteAnimationDefinition(definition, { ...manifest, resolution: 0.3 }))
      .toThrow("pixel frameWidth");
  });

  it("uses manifest density for pixel validation and rejects a mismatched texture density", () => {
    const normalized = normalizeDeviceSpriteAnimationDefinition(definition, { ...manifest, resolution: 0.5 });
    const page = normalized.clips.open!.pages[0]!;
    expect(resolveDeviceSpriteAnimationGrid(normalized, page, { width: 2, height: 1 }))
      .toEqual({ frameWidth: 2, frameHeight: 2 });
    expect(() => resolveDeviceSpriteAnimationGrid(normalized, page, { width: 4, height: 2, resolution: 1 }))
      .toThrow("resolution differs");
  });
  it("keeps frame geometry, UVs and masks aligned at half resolution and counts actual pixels", async () => {
    const context = createCache({ resolution: 0.5, maxSize: 4 });
    try {
      const animation = await context.cache.get("half-resolution", definition);
      expect(animation).not.toBeNull();
      const texture = await animation!.prepareFrame("open", 1);
      // 串行预上传后，以队列完成作为预取就绪条件，不再依赖三个微任务内加载全部页。
      await waitForPreparedPages(context.cache);
      expect(texture).toMatchObject({
        width: 2, height: 2,
        frame: { x: 2, y: 0, width: 2, height: 2 },
        source: { pixelWidth: 2, pixelHeight: 1, width: 4, height: 2, resolution: 0.5 },
        uvs: { x0: 0.5, y0: 0, x1: 1, y1: 0, x2: 1, y2: 1, x3: 0.5, y3: 1 },
      });
      expect(animation!.mask).toMatchObject({
        width: 2, height: 2, source: { pixelWidth: 1, pixelHeight: 1 },
      });
      expect(context.cache.getStats()).toMatchObject({
        residentMasks: 1, residentPages: 5, residentDecodedBytes: 40,
      });
      animation!.commitFrame("open", 1);
      animation!.destroy();
      await flushMicrotasks();
      expect(context.cache.getStats()).toMatchObject({ residentPages: 5, residentDecodedBytes: 40 });
    } finally { context.dispose(); }
  });

  it("unloads a mask that fails logical size validation", async () => {
    const mask = createTexture(4, 2, 0.5);
    const unload = vi.fn(async (_path: string, texture: Texture) => { texture.destroy(true); });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const cache = new DeviceAnimationTextureCache({
      loadManifest: async () => manifest,
      loadTexture: async () => mask,
      unloadTexture: unload,
      configureTexture: () => undefined,
      getMaxTextureSize: () => 4096,
      uploadTexture: () => undefined,
    });
    try {
      expect(await cache.get("bad-mask-size", definition)).toBeNull();
      expect(unload).toHaveBeenCalledTimes(1);
      expect(mask.destroyed).toBe(true);
    } finally {
      cache.destroy();
      errors.mockRestore();
    }
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid texture resolution %s", (resolution) => {
    const normalized = normalizeDeviceSpriteAnimationDefinition(definition, manifest);
    expect(() => resolveDeviceSpriteAnimationGrid(normalized, normalized.clips.open!.pages[0]!, {
      width: 2, height: 1, resolution,
    })).toThrow("resolution");
  });

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
      await waitForPreparedPages(context.cache);
      expect(firstTexture).not.toBeNull();
      expect(secondTexture).toBe(firstTexture);
      expect(context.requests.filter((path) => path.endsWith("open-0.webp"))).toHaveLength(1);
      expect(context.requests.filter((path) => path.endsWith("open-1.webp"))).toHaveLength(1);
      expect(context.cache.getStats()).toMatchObject({
        activeSessions: 2,
        residentMasks: 1,
        residentPages: 5,
        residentDecodedBytes: 160,
      });

      first!.commitFrame("open", 0);
      second!.commitFrame("open", 0);
      first!.destroy();
      await flushMicrotasks();
      expect(context.unloads.some((path) => path.endsWith("open-0.webp"))).toBe(false);
      second!.destroy();
      await flushMicrotasks();
      // 最后一个会话销毁只启动 20 秒期限；整套资源与其他可见性退出路径使用相同规则。
      expect(context.unloads.some((path) => path.endsWith("open-0.webp"))).toBe(false);
      expect(context.unloads.some((path) => path.endsWith("open-1.webp"))).toBe(false);
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
      uploadTexture: () => undefined,
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
      uploadTexture: () => undefined,
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
    const page = normalized.clips.open!.pages[0]!;
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

  it("accepts optional transitions and rejects an unknown playback target or close idle strategy", () => {
    const clipsWithoutClose = {
      open: manifest.clips.open,
      open_idle: manifest.clips.open_idle,
      close_idle: manifest.clips.close_idle,
    };
    expect(() => normalizeDeviceSpriteAnimationDefinition(definition, {
      ...manifest,
      clips: clipsWithoutClose,
      playback: { ...manifest.playback, closeTransitionClip: null },
    })).not.toThrow();
    expect(() => normalizeDeviceSpriteAnimationDefinition(definition, {
      ...manifest,
      playback: { ...manifest.playback, fallbackClip: "missing" },
    })).toThrow("unknown clip");
    expect(() => normalizeDeviceSpriteAnimationDefinition({ closeIdleMode: "ping-pong" }, manifest))
      .toThrow();
  });

  it("保留来源 status 元数据，但不会因相同数值把 PORT_DISCONNECT 映射成 blocked", () => {
    const explicitManifest = {
      ...manifest,
      playback: {
        fallbackClip: "close_idle",
        staticClip: "open_idle",
        statusClips: { normal: "open_idle" },
        openTransitionClip: "open",
        closeTransitionClip: "close",
        sourceStatuses: {
          PORT_DISCONNECT: {
            statusKey: 5,
            clip: "close_idle",
            playing: false,
            restart: true,
          },
        },
      },
    };
    const normalized = normalizeDeviceSpriteAnimationDefinition(definition, explicitManifest);
    expect(normalized.playback.sourceStatuses.PORT_DISCONNECT?.statusKey).toBe(5);
    expect(normalized.playback.statusClips.blocked).toBeUndefined();
  });
});
