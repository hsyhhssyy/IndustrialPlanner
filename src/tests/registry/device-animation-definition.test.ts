// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { ENTITY_DEFINITIONS } from "@/registry/entity-definition";
import { normalizeDeviceSpriteAnimationDefinition } from "@/shared/device-sprite-animation";

const COMPONENT_MACHINE_SPRITE_ID = "item_port_cmpt_mc_1";

describe("device animation definitions", () => {
  it("publishes the fitting unit idle loop through the four-phase runtime contract", async () => {
    const entity = ENTITY_DEFINITIONS.find((candidate) => candidate.id === "cmpt_mc_1");
    expect(entity).toBeDefined();
    expect(entity?.spriteId).toBe(COMPONENT_MACHINE_SPRITE_ID);
    expect(entity?.spriteAnimation).toEqual({ closeIdleMode: "hold-last" });

    const sourceManifest = JSON.parse(await readFile(path.resolve(
      `resources/device-sprite-animation/${COMPONENT_MACHINE_SPRITE_ID}/manifest.json`,
    ), "utf8"));
    // AI-CORRECTION 2026-09-11: v1.5 ZIP source declares 30fps and 151 source frames.
    // 本次交付将连续重复帧合并为 99 帧，保留 5033ms 总时长与非等长停留。
    expect(sourceManifest.fps).toBe(30);
    expect(sourceManifest.clips.open).toEqual([
      { source: "close_idle_000", startFrame: 0, frameCount: 1 },
    ]);
    expect(sourceManifest.clips.open_idle.reduce(
      (total: number, range: { frameCount: number }) => total + range.frameCount,
      0,
    )).toBe(99);
    expect(sourceManifest.clips.close).toEqual([
      { source: "close_idle_000", startFrame: 0, frameCount: 1 },
    ]);
    // AI-REMOVED 2026-09-11:
    // Reason: 新交付把 close_idle 的两个相同源帧合并为单帧。
    // Trigger: 用户要求按 v1.5 JSON 更新全部建筑素材。
    // Evidence: component_mc_1 的 close_idle/animation.json 声明 retainedFrameCount=1、durationMs=67。
    // Replacement: 下方单帧声明与运行时 67ms 时间线断言。
    // Risk: Low
    // Human Review: Required
    // Original code:
    // expect(sourceManifest.clips.close_idle).toEqual([
    //   { source: "close_idle_000", startFrame: 0, frameCount: 1 },
    //   { source: "close_idle_000", startFrame: 0, frameCount: 1 },
    // ]);
    expect(sourceManifest.clips.close_idle).toEqual([
      { source: "close_idle_000", startFrame: 0, frameCount: 1 },
    ]);
    expect(sourceManifest.sources.open_idle_000.frameDurationsMs).toEqual(
      expect.arrayContaining([67, 400, 500, 533]),
    );

    const animationDirectory = path.resolve(`public/3d-top-view/animations/${COMPONENT_MACHINE_SPRITE_ID}`);
    const runtimeManifest = JSON.parse(await readFile(path.join(animationDirectory, "manifest.json"), "utf8"));
    const normalized = normalizeDeviceSpriteAnimationDefinition(entity?.spriteAnimation, runtimeManifest);
    expect(normalized).toMatchObject({
      closeIdleMode: "hold-last",
      frameWidth: 384,
      frameHeight: 384,
      clips: {
        open: { frameCount: 1 },
        open_idle: { frameCount: 99 },
        close: { frameCount: 1 },
        close_idle: { frameCount: 1 },
      },
    });
    const sourceTimeline: number[] = sourceManifest.clips.open_idle.flatMap((range: { source: string; startFrame: number; frameCount: number }) => {
      const durations = sourceManifest.sources[range.source].frameDurationsMs;
      return durations.slice(range.startFrame, range.startFrame + range.frameCount);
    });
    expect(sourceTimeline.reduce((total: number, duration: number) => total + duration, 0)).toBe(5033);
    expect(normalized.clips.open_idle.durationMs).toBe(5033);
    expect(normalized.clips.open_idle.frameEndTimesMs.at(-1)).toBe(5033);
    expect(normalized.clips.open_idle.pages.map((page) => page.frameCount)).toEqual([35, 35, 29]);
    expect(normalized.clips.close_idle.durationMs).toBe(67);
    expect(sourceTimeline).toHaveLength(99);
    expect(runtimeManifest.clips.open_idle.frameDurationsMs).toEqual(sourceTimeline);
    let elapsedMs = 0;
    expect(normalized.clips.open_idle.frameEndTimesMs).toEqual(sourceTimeline.map((duration) => {
      elapsedMs += duration;
      return elapsedMs;
    }));
    expect(normalized.clips.close_idle.frameEndTimesMs).toEqual([67]);

    await Promise.all(Object.values(normalized.clips).flatMap((clip) => clip.pages.map(async (page) => {
      const metadata = await sharp(path.join(animationDirectory, page.file)).metadata();
      expect(metadata.width).toBe(page.columns * normalized.frameWidth);
      expect(metadata.height).toBe(page.rows * normalized.frameHeight);
      expect(metadata.hasAlpha).toBe(true);
    })));

    const [staticMetadata, staticMaskMetadata, animationMaskMetadata] = await Promise.all([
      sharp(path.resolve(`public/3d-top-view/sprites/${COMPONENT_MACHINE_SPRITE_ID}.webp`)).metadata(),
      sharp(path.resolve(`public/3d-top-view/sprite-masks/${COMPONENT_MACHINE_SPRITE_ID}.webp`)).metadata(),
      sharp(path.join(animationDirectory, normalized.maskFile)).metadata(),
    ]);
    expect([staticMetadata.width, staticMetadata.height]).toEqual([384, 384]);
    expect([staticMaskMetadata.width, staticMaskMetadata.height]).toEqual([384, 384]);
    expect([animationMaskMetadata.width, animationMaskMetadata.height]).toEqual([384, 384]);
  });
});
