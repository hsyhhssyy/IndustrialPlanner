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
    expect(sourceManifest.fps).toBeCloseTo(100 / 3);
    expect(sourceManifest.clips.open).toEqual([
      { source: "close_idle_000", startFrame: 0, frameCount: 1 },
    ]);
    expect(sourceManifest.clips.open_idle.reduce(
      (total: number, range: { frameCount: number }) => total + range.frameCount,
      0,
    )).toBe(151);
    expect(sourceManifest.clips.close).toEqual([
      { source: "close_idle_000", startFrame: 0, frameCount: 1 },
    ]);
    expect(sourceManifest.clips.close_idle).toEqual([
      { source: "close_idle_000", startFrame: 0, frameCount: 1 },
      { source: "close_idle_000", startFrame: 0, frameCount: 1 },
    ]);

    const animationDirectory = path.resolve(`public/3d-top-view/animations/${COMPONENT_MACHINE_SPRITE_ID}`);
    const runtimeManifest = JSON.parse(await readFile(path.join(animationDirectory, "manifest.json"), "utf8"));
    const normalized = normalizeDeviceSpriteAnimationDefinition(entity?.spriteAnimation, runtimeManifest);
    expect(normalized).toMatchObject({
      closeIdleMode: "hold-last",
      frameWidth: 384,
      frameHeight: 384,
      clips: {
        open: { frameCount: 1 },
        open_idle: { frameCount: 151 },
        close: { frameCount: 1 },
        close_idle: { frameCount: 2 },
      },
    });
    expect(normalized.clips.open_idle.durationMs).toBeCloseTo(4_530);
    expect(normalized.clips.open_idle.pages.map((page) => page.frameCount)).toEqual([100, 51]);
    expect(normalized.clips.close_idle.durationMs).toBeCloseTo(60);

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
