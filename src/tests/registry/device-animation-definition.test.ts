// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { ENTITY_DEFINITIONS } from "@/registry/entity-definition";
import { normalizeDeviceSpriteAnimationDefinition } from "@/shared/device-sprite-animation";
// @ts-expect-error Node 发布配置直接复用，测试不得复制发布比例。
import { BUILDING_ASSET_PUBLISH_RESOLUTIONS } from "../../scripts/building-asset-publish-config.mjs";

const COMPONENT_MACHINE_ENTITY_ID = "cmpt_mc_1";
const ANIMATION_PHASES = ["open", "open_idle", "close", "close_idle"] as const;

type AnimationPhase = typeof ANIMATION_PHASES[number];

interface SourceAnimationManifest {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly fps: number;
  readonly sources: Record<string, {
    readonly frameDurationsMs: readonly number[];
  }>;
  readonly clips: Record<AnimationPhase, readonly {
    readonly source: string;
    readonly startFrame: number;
    readonly frameCount: number;
  }[]>;
  readonly sourceSite: {
    readonly releaseId: string;
    readonly indexSha256: string;
  };
}

describe("device animation definitions", () => {
  it("publishes the fitting unit idle loop through the four-phase runtime contract", async () => {
    const entity = ENTITY_DEFINITIONS.find((candidate) => candidate.id === COMPONENT_MACHINE_ENTITY_ID);
    expect(entity).toBeDefined();
    if (entity === undefined) throw new Error(`Missing entity definition: ${COMPONENT_MACHINE_ENTITY_ID}`);
    expect(entity.spriteAnimation).toEqual({ closeIdleMode: "hold-last" });
    const spriteId = entity.spriteId;

    const sourceManifest = JSON.parse(await readFile(path.resolve(
      `resources/device-sprite-animation/${spriteId}/manifest.json`,
    ), "utf8")) as SourceAnimationManifest;
    // AI-CORRECTION 2026-09-11: v1.5 ZIP source declares 30fps and 151 source frames.
    // 本次交付将连续重复帧合并为 99 帧，保留 5033ms 总时长与非等长停留。
    // AI-CORRECTION 2026-09-14: 发布测试从固定来源 manifest 读取帧数和时长，不再复制具体交付值。
    expect(sourceManifest.fps).toBeGreaterThan(0);
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
    // AI-CORRECTION 2026-09-14: close_idle 与其他阶段统一从来源范围解析，不再固定来源文件名或帧数。
    const sourceTimelines = Object.fromEntries(ANIMATION_PHASES.map((phase) => {
      expect(sourceManifest.clips[phase].length).toBeGreaterThan(0);
      const timeline = sourceManifest.clips[phase].flatMap((range) => {
        const source = sourceManifest.sources[range.source];
        expect(source, `${phase} references missing source ${range.source}`).toBeDefined();
        if (source === undefined) throw new Error(`${phase} references missing source ${range.source}`);
        expect(range.startFrame).toBeGreaterThanOrEqual(0);
        expect(range.startFrame + range.frameCount).toBeLessThanOrEqual(source.frameDurationsMs.length);
        return source.frameDurationsMs.slice(range.startFrame, range.startFrame + range.frameCount);
      });
      expect(timeline.length).toBeGreaterThan(0);
      expect(timeline.every((duration) => Number.isFinite(duration) && duration > 0)).toBe(true);
      return [phase, timeline];
    })) as Record<AnimationPhase, number[]>;

    const animationDirectory = path.resolve(`public/3d-top-view/animations/${spriteId}`);
    const runtimeManifest = JSON.parse(await readFile(path.join(animationDirectory, "manifest.json"), "utf8"));
    expect(runtimeManifest.sourceSite).toMatchObject({
      releaseId: sourceManifest.sourceSite.releaseId,
      indexSha256: sourceManifest.sourceSite.indexSha256,
    });
    const normalized = normalizeDeviceSpriteAnimationDefinition(entity.spriteAnimation, runtimeManifest);
    expect(normalized.closeIdleMode).toBe(entity.spriteAnimation?.closeIdleMode);
    expect(normalized.frameWidth).toBe(sourceManifest.frameWidth);
    expect(normalized.frameHeight).toBe(sourceManifest.frameHeight);
    expect(normalized.resolution).toBe(BUILDING_ASSET_PUBLISH_RESOLUTIONS[0]);

    for (const phase of ANIMATION_PHASES) {
      const sourceTimeline = sourceTimelines[phase];
      const expectedFrameEndTimes: number[] = [];
      let elapsedMs = 0;
      for (const duration of sourceTimeline) {
        elapsedMs += duration;
        expectedFrameEndTimes.push(elapsedMs);
      }
      expect(runtimeManifest.clips[phase].frameDurationsMs).toEqual(sourceTimeline);
      expect(normalized.clips[phase].frameCount).toBe(sourceTimeline.length);
      expect(normalized.clips[phase].durationMs).toBe(elapsedMs);
      expect(normalized.clips[phase].frameEndTimesMs).toEqual(expectedFrameEndTimes);
      expect(normalized.clips[phase].pages.reduce((total, page) => total + page.frameCount, 0))
        .toBe(sourceTimeline.length);
    }

    await Promise.all(Object.values(normalized.clips).flatMap((clip) => clip.pages.map(async (page) => {
      const metadata = await sharp(path.join(animationDirectory, page.file)).metadata();
      expect(metadata.width).toBe(page.columns * normalized.frameWidth * normalized.resolution);
      expect(metadata.height).toBe(page.rows * normalized.frameHeight * normalized.resolution);
      expect(metadata.hasAlpha).toBe(true);
    })));

    const [staticMetadata, staticMaskMetadata, animationMaskMetadata] = await Promise.all([
      sharp(path.resolve(`public/3d-top-view/sprites/${spriteId}.webp`)).metadata(),
      sharp(path.resolve(`public/3d-top-view/sprite-masks/${spriteId}.webp`)).metadata(),
      sharp(path.join(animationDirectory, normalized.maskFile)).metadata(),
    ]);
    const publishedFrameSize = [
      normalized.frameWidth * normalized.resolution,
      normalized.frameHeight * normalized.resolution,
    ];
    expect(publishedFrameSize.every(Number.isInteger)).toBe(true);
    expect([staticMetadata.width, staticMetadata.height]).toEqual(publishedFrameSize);
    expect([staticMaskMetadata.width, staticMaskMetadata.height]).toEqual(publishedFrameSize);
    expect([animationMaskMetadata.width, animationMaskMetadata.height]).toEqual(publishedFrameSize);
  });
});
