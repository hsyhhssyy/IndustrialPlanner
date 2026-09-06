import { Rectangle, Texture } from "pixi.js";

import type { DeviceSpriteAnimationDefinition } from "@/domain/registry";
import { createPublicAssetUrl } from "@/shared/browser/public-asset-url";
import {
  DEVICE_SPRITE_ANIMATION_PHASES,
  getDeviceSpriteAnimationSignature,
  normalizeDeviceSpriteAnimationDefinition,
  resolveDeviceSpriteAnimationGrid,
  validateDeviceSpriteAnimationId,
  type DeviceSpriteAnimationPhase,
  type NormalizedDeviceSpriteAnimationDefinition,
} from "@/shared/device-sprite-animation";

export interface DeviceAnimationTextures {
  readonly clips: Readonly<Record<DeviceSpriteAnimationPhase, readonly Texture[]>>;
  readonly mask: Texture;
  readonly frameWidth: number;
  readonly frameHeight: number;
}

/** 只拥有子纹理；图片源由统一 Assets 缓存持有，不能随设备或管理器销毁。 */
export class DeviceAnimationTextureCache {
  private readonly entries = new Map<string, {
    readonly signature: string;
    readonly promise: Promise<DeviceAnimationTextures | null>;
  }>();
  private readonly reportedErrors = new Set<string>();
  private readonly ownedFrames = new Set<Texture>();
  private destroyed = false;

  public constructor(private readonly options: {
    readonly loadTexture: (path: string) => Promise<Texture>;
    readonly configureTexture: (texture: Texture) => void;
    readonly getMaxTextureSize: () => number;
  }) {}

  public get(spriteId: string, definition: DeviceSpriteAnimationDefinition): Promise<DeviceAnimationTextures | null> {
    if (this.destroyed) {
      return Promise.resolve(null);
    }
    let normalized: NormalizedDeviceSpriteAnimationDefinition;
    try {
      validateDeviceSpriteAnimationId(spriteId);
      normalized = normalizeDeviceSpriteAnimationDefinition(definition);
    } catch (error) {
      this.report(spriteId, error);
      return Promise.resolve(null);
    }
    const signature = getDeviceSpriteAnimationSignature(normalized);
    const existing = this.entries.get(spriteId);
    if (existing !== undefined) {
      if (existing.signature !== signature) {
        this.report(spriteId, new Error("Conflicting animation definitions share one spriteId"));
        return Promise.resolve(null);
      }
      return existing.promise;
    }
    const promise = this.load(spriteId, normalized).catch((error: unknown) => {
      if (!this.destroyed) {
        this.report(spriteId, error);
      }
      return null;
    });
    this.entries.set(spriteId, { signature, promise });
    return promise;
  }

  public destroy(): void {
    this.destroyed = true;
    for (const texture of this.ownedFrames) {
      texture.destroy(false);
    }
    this.ownedFrames.clear();
    this.entries.clear();
    this.reportedErrors.clear();
  }

  private report(spriteId: string, error: unknown): void {
    if (this.reportedErrors.has(spriteId)) {
      return;
    }
    this.reportedErrors.add(spriteId);
    console.error(`[DeviceAnimation] ${spriteId}: animation unavailable; using static sprite.`, error);
  }

  private async load(
    spriteId: string,
    definition: NormalizedDeviceSpriteAnimationDefinition,
  ): Promise<DeviceAnimationTextures | null> {
    const names = [...DEVICE_SPRITE_ANIMATION_PHASES, "mask"] as const;
    const loaded = await Promise.allSettled(names.map((name) => this.options.loadTexture(
      createPublicAssetUrl(`3d-top-view/animations/${spriteId}/${name}.webp`),
    )));
    if (this.destroyed) {
      return null;
    }
    const textures: Texture[] = [];
    for (const result of loaded) {
      if (result.status === "rejected") {
        throw result.reason;
      }
      textures.push(result.value);
    }
    const atlases = Object.fromEntries(DEVICE_SPRITE_ANIMATION_PHASES.map((phase, index) => [
      phase, textures[index]!,
    ])) as Record<DeviceSpriteAnimationPhase, Texture>;
    for (const texture of textures) {
      if (texture.destroyed || texture.source.destroyed || texture.source.resolution !== 1
        || texture.frame.x !== 0 || texture.frame.y !== 0 || texture.rotate !== 0
        || texture.width !== texture.source.pixelWidth || texture.height !== texture.source.pixelHeight) {
        throw new Error("Animation resources must be complete, unscaled image textures");
      }
    }
    const dimensions = Object.fromEntries(DEVICE_SPRITE_ANIMATION_PHASES.map((phase) => [phase, {
      width: atlases[phase].source.pixelWidth,
      height: atlases[phase].source.pixelHeight,
    }])) as Record<DeviceSpriteAnimationPhase, { width: number; height: number }>;
    const { frameWidth, frameHeight } = resolveDeviceSpriteAnimationGrid(
      definition, dimensions, this.options.getMaxTextureSize(),
    );
    const mask = textures[4]!;
    if (mask.width !== frameWidth || mask.height !== frameHeight) {
      throw new Error("Animation union mask dimensions differ from frame dimensions");
    }
    for (const texture of textures) {
      this.options.configureTexture(texture);
    }
    const frames: Texture[] = [];
    try {
      const clips = {} as Record<DeviceSpriteAnimationPhase, readonly Texture[]>;
      for (const phase of DEVICE_SPRITE_ANIMATION_PHASES) {
        const clip = definition.clips[phase];
        clips[phase] = Object.freeze(Array.from({ length: clip.frameCount }, (_, index) => {
          const texture = new Texture({
            source: atlases[phase].source,
            frame: new Rectangle(
              (index % clip.columns) * frameWidth,
              Math.floor(index / clip.columns) * frameHeight,
              frameWidth,
              frameHeight,
            ),
          });
          frames.push(texture);
          return texture;
        }));
      }
      for (const frame of frames) {
        this.ownedFrames.add(frame);
      }
      return Object.freeze({ clips: Object.freeze(clips), mask, frameWidth, frameHeight });
    } catch (error) {
      for (const frame of frames) {
        frame.destroy(false);
      }
      throw error;
    }
  }
}
