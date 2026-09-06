import type { DeviceSpriteAnimationDefinition } from "../domain/registry";

export const DEVICE_SPRITE_ANIMATION_PHASES = ["open", "open_idle", "close", "close_idle"] as const;
export const DEFAULT_DEVICE_SPRITE_FRAME_DURATION_MS = 100;
/** 离线发布的保守上限；运行时还须检查当前 GPU 的实际限制。 */
export const DEVICE_SPRITE_ANIMATION_MAX_TEXTURE_SIZE = 4096;
export type DeviceSpriteAnimationPhase = typeof DEVICE_SPRITE_ANIMATION_PHASES[number];

export interface NormalizedDeviceSpriteAnimationClipDefinition {
  readonly rows: number;
  readonly columns: number;
  readonly frameCount: number;
  readonly frameDurationMs: number;
  readonly durationMs: number;
}

export interface NormalizedDeviceSpriteAnimationDefinition {
  readonly clips: Readonly<Record<DeviceSpriteAnimationPhase, NormalizedDeviceSpriteAnimationClipDefinition>>;
  readonly closeIdleMode: DeviceSpriteAnimationDefinition["closeIdleMode"];
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

export function normalizeDeviceSpriteAnimationDefinition(
  definition: unknown,
): NormalizedDeviceSpriteAnimationDefinition {
  const source = requireRecord(definition, "spriteAnimation");
  if (source.closeIdleMode !== "loop" && source.closeIdleMode !== "hold-last") {
    throw new Error("spriteAnimation.closeIdleMode must be loop or hold-last");
  }
  const sourceClips = requireRecord(source.clips, "spriteAnimation.clips");
  const clips = {} as Record<DeviceSpriteAnimationPhase, NormalizedDeviceSpriteAnimationClipDefinition>;
  for (const phase of DEVICE_SPRITE_ANIMATION_PHASES) {
    const clip = requireRecord(sourceClips[phase], `spriteAnimation.clips.${phase}`);
    const rows = requirePositiveInteger(clip.rows, `${phase}.rows`);
    const columns = requirePositiveInteger(clip.columns, `${phase}.columns`);
    const frameCount = requirePositiveInteger(rows * columns, `${phase}.frameCount`);
    const frameDurationMs = clip.frameDurationMs === undefined
      ? DEFAULT_DEVICE_SPRITE_FRAME_DURATION_MS
      : clip.frameDurationMs;
    if (typeof frameDurationMs !== "number" || !Number.isFinite(frameDurationMs)
      || frameDurationMs <= 0 || frameDurationMs * frameCount > Number.MAX_SAFE_INTEGER) {
      throw new Error(`${phase}.frameDurationMs must produce a finite positive safe duration`);
    }
    clips[phase] = Object.freeze({ rows, columns, frameCount, frameDurationMs, durationMs: frameDurationMs * frameCount });
  }
  return Object.freeze({ clips: Object.freeze(clips), closeIdleMode: source.closeIdleMode });
}

export function getDeviceSpriteAnimationSignature(definition: NormalizedDeviceSpriteAnimationDefinition): string {
  return JSON.stringify(definition);
}

export function validateDeviceSpriteAnimationId(spriteId: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(spriteId)) {
    throw new Error(`Invalid animation spriteId: ${spriteId}`);
  }
}

/** 构建与运行时共用同一网格边界，禁止缩放、余数裁剪和跨阶段尺寸变化。 */
export function resolveDeviceSpriteAnimationGrid(
  definition: NormalizedDeviceSpriteAnimationDefinition,
  dimensions: Readonly<Record<DeviceSpriteAnimationPhase, { readonly width: number; readonly height: number }>>,
  maxTextureSize: number = DEVICE_SPRITE_ANIMATION_MAX_TEXTURE_SIZE,
): { readonly frameWidth: number; readonly frameHeight: number } {
  requirePositiveInteger(maxTextureSize, "maxTextureSize");
  let frameWidth = 0;
  let frameHeight = 0;
  for (const phase of DEVICE_SPRITE_ANIMATION_PHASES) {
    const { width, height } = dimensions[phase];
    requirePositiveInteger(width, `${phase}.width`);
    requirePositiveInteger(height, `${phase}.height`);
    const clip = definition.clips[phase];
    if (width > maxTextureSize || height > maxTextureSize) {
      throw new Error(`${phase} atlas exceeds GPU texture limit ${maxTextureSize}`);
    }
    if (width % clip.columns !== 0 || height % clip.rows !== 0) {
      throw new Error(`${phase} atlas dimensions must divide evenly by its grid`);
    }
    const currentWidth = width / clip.columns;
    const currentHeight = height / clip.rows;
    if (frameWidth !== 0 && (frameWidth !== currentWidth || frameHeight !== currentHeight)) {
      throw new Error(`${phase} frame dimensions differ from other phases`);
    }
    frameWidth = currentWidth;
    frameHeight = currentHeight;
  }
  return { frameWidth, frameHeight };
}
