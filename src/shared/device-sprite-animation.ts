import type { DeviceSpriteAnimationDefinition } from "../domain/registry";

export const DEVICE_SPRITE_ANIMATION_PHASES = ["open", "open_idle", "close", "close_idle"] as const;
export const DEFAULT_DEVICE_SPRITE_FRAME_DURATION_MS = 100;
/** 离线发布的保守上限；运行时还须检查当前 GPU 的实际限制。 */
export const DEVICE_SPRITE_ANIMATION_MAX_TEXTURE_SIZE = 4096;
export type DeviceSpriteAnimationPhase = typeof DEVICE_SPRITE_ANIMATION_PHASES[number];

export interface DeviceSpriteAnimationManifestPage {
  readonly file: string;
  readonly rows: number;
  readonly columns: number;
  readonly frameCount: number;
  readonly firstFrameIndex: number;
}

export interface NormalizedDeviceSpriteAnimationClipDefinition {
  // AI-REMOVED 2026-09-06:
  // Reason: 逻辑片段不再绑定单张图集，行列属于 pages 中的单页布局。
  // Trigger: 反应池一个阶段需要多页且末页包含透明空格。
  // Evidence: manifest 为每页独立声明 rows、columns、frameCount。
  // Replacement: pages: readonly DeviceSpriteAnimationManifestPage[]。
  // Risk: Low；所有使用方改为通过 resolveDeviceSpriteAnimationFrame 定位页面。
  // Human Review: Required
  //
  // Original code:
  // readonly rows: number;
  // readonly columns: number;
  readonly frameCount: number;
  readonly frameDurationMs: number;
  /** 每帧结束时刻；支持美术合并重复帧后保留的非等长停留时间。 */
  readonly frameEndTimesMs: readonly number[];
  readonly durationMs: number;
  readonly pages: readonly DeviceSpriteAnimationManifestPage[];
  /** 逐帧直接定位分页，避免 30 FPS × 多设备时反复线性扫描页表。 */
  readonly pageIndexByFrame: readonly number[];
}

export interface NormalizedDeviceSpriteAnimationDefinition {
  readonly clips: Readonly<Record<DeviceSpriteAnimationPhase, NormalizedDeviceSpriteAnimationClipDefinition>>;
  readonly closeIdleMode: DeviceSpriteAnimationDefinition["closeIdleMode"];
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly maskFile: string;
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

function requireAssetFile(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]+\.webp$/.test(value)) {
    throw new Error(`${label} must be a local WebP file name`);
  }
  return value;
}

export function normalizeDeviceSpriteAnimationDefinition(
  definition: unknown,
  manifest: unknown,
): NormalizedDeviceSpriteAnimationDefinition {
  const source = requireRecord(definition, "spriteAnimation");
  if (source.closeIdleMode !== "loop" && source.closeIdleMode !== "hold-last") {
    throw new Error("spriteAnimation.closeIdleMode must be loop or hold-last");
  }
  const manifestSource = requireRecord(manifest, "animation manifest");
  if (manifestSource.schemaVersion !== 1) {
    throw new Error("animation manifest.schemaVersion must be 1");
  }
  const frameWidth = requirePositiveInteger(manifestSource.frameWidth, "animation manifest.frameWidth");
  const frameHeight = requirePositiveInteger(manifestSource.frameHeight, "animation manifest.frameHeight");
  const maskFile = requireAssetFile(manifestSource.maskFile, "animation manifest.maskFile");
  const sourceClips = requireRecord(manifestSource.clips, "animation manifest.clips");
  const clips = {} as Record<DeviceSpriteAnimationPhase, NormalizedDeviceSpriteAnimationClipDefinition>;
  const pageFiles = new Set<string>();
  for (const phase of DEVICE_SPRITE_ANIMATION_PHASES) {
    const clip = requireRecord(sourceClips[phase], `animation manifest.clips.${phase}`);
    const frameCount = requirePositiveInteger(clip.frameCount, `${phase}.frameCount`);
    const frameDurationMs = clip.frameDurationMs === undefined
      ? DEFAULT_DEVICE_SPRITE_FRAME_DURATION_MS
      : clip.frameDurationMs;
    if (typeof frameDurationMs !== "number" || !Number.isFinite(frameDurationMs)
      || frameDurationMs <= 0 || frameDurationMs * frameCount > Number.MAX_SAFE_INTEGER) {
      throw new Error(`${phase}.frameDurationMs must produce a finite positive safe duration`);
    }
    const durations = clip.frameDurationsMs;
    if (durations !== undefined && (!Array.isArray(durations) || durations.length !== frameCount)) {
      throw new Error(`${phase}.frameDurationsMs must contain one duration per frame`);
    }
    let durationMs = 0;
    const frameEndTimesMs = Object.freeze(Array.from({ length: frameCount }, (_, index) => {
      const duration: unknown = durations === undefined ? frameDurationMs : durations[index];
      if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0
        || durationMs + duration > Number.MAX_SAFE_INTEGER || durationMs + duration <= durationMs) {
        throw new Error(`${phase}.frameDurationsMs must contain finite positive safe durations`);
      }
      durationMs = durations === undefined ? (index + 1) * frameDurationMs : durationMs + duration;
      return durationMs;
    }));
    const clipPages = clip.pages;
    if (!Array.isArray(clipPages) || clipPages.length === 0) {
      throw new Error(`${phase}.pages must be a non-empty array`);
    }
    let firstFrameIndex = 0;
    const pages = clipPages.map((pageValue, pageIndex) => {
      const page = requireRecord(pageValue, `${phase}.pages[${pageIndex}]`);
      const file = requireAssetFile(page.file, `${phase}.pages[${pageIndex}].file`);
      if (pageFiles.has(file)) {
        throw new Error(`animation page file must be unique: ${file}`);
      }
      pageFiles.add(file);
      const rows = requirePositiveInteger(page.rows, `${phase}.pages[${pageIndex}].rows`);
      const columns = requirePositiveInteger(page.columns, `${phase}.pages[${pageIndex}].columns`);
      const pageFrameCount = requirePositiveInteger(
        page.frameCount,
        `${phase}.pages[${pageIndex}].frameCount`,
      );
      const capacity = requirePositiveInteger(rows * columns, `${phase}.pages[${pageIndex}].capacity`);
      if (pageFrameCount > capacity) {
        throw new Error(`${phase}.pages[${pageIndex}].frameCount exceeds its grid capacity`);
      }
      if (pageIndex < clipPages.length - 1 && pageFrameCount !== capacity) {
        throw new Error(`${phase}.pages[${pageIndex}] must be full; only the final page may contain trailing blanks`);
      }
      const normalizedPage = Object.freeze({ file, rows, columns, frameCount: pageFrameCount, firstFrameIndex });
      firstFrameIndex += pageFrameCount;
      return normalizedPage;
    });
    if (firstFrameIndex !== frameCount) {
      throw new Error(`${phase}.frameCount must equal the sum of its page frameCount values`);
    }
    const pageIndexByFrame = Object.freeze(pages.flatMap((page, pageIndex) => (
      Array.from({ length: page.frameCount }, () => pageIndex)
    )));
    clips[phase] = Object.freeze({
      frameCount,
      frameDurationMs,
      frameEndTimesMs,
      durationMs,
      pages: Object.freeze(pages),
      pageIndexByFrame,
    });
  }
  return Object.freeze({
    clips: Object.freeze(clips),
    closeIdleMode: source.closeIdleMode,
    frameWidth,
    frameHeight,
    maskFile,
  });
}

export function getDeviceSpriteAnimationSignature(definition: DeviceSpriteAnimationDefinition): string {
  return JSON.stringify({ closeIdleMode: definition.closeIdleMode });
}

export function validateDeviceSpriteAnimationId(spriteId: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(spriteId)) {
    throw new Error(`Invalid animation spriteId: ${spriteId}`);
  }
}

/** 构建与运行时共用同一网格边界，禁止缩放、余数裁剪和跨阶段尺寸变化。 */
/** AI-CORRECTION 2026-09-06: 校验单位由“四阶段各一张图”改为 manifest 中的单个分页。 */
export function resolveDeviceSpriteAnimationGrid(
  definition: NormalizedDeviceSpriteAnimationDefinition,
  page: DeviceSpriteAnimationManifestPage,
  dimensions: { readonly width: number; readonly height: number },
  maxTextureSize: number = DEVICE_SPRITE_ANIMATION_MAX_TEXTURE_SIZE,
): { readonly frameWidth: number; readonly frameHeight: number } {
  requirePositiveInteger(maxTextureSize, "maxTextureSize");
  const width = requirePositiveInteger(dimensions.width, `${page.file}.width`);
  const height = requirePositiveInteger(dimensions.height, `${page.file}.height`);
  if (width >= maxTextureSize || height >= maxTextureSize) {
    throw new Error(`${page.file} must be smaller than GPU texture limit ${maxTextureSize}`);
  }
  if (width !== page.columns * definition.frameWidth || height !== page.rows * definition.frameHeight) {
    throw new Error(`${page.file} dimensions differ from its manifest grid`);
  }
  return { frameWidth: definition.frameWidth, frameHeight: definition.frameHeight };
}

export function resolveDeviceSpriteAnimationFrame(
  definition: NormalizedDeviceSpriteAnimationDefinition,
  phase: DeviceSpriteAnimationPhase,
  frameIndex: number,
): { readonly page: DeviceSpriteAnimationManifestPage; readonly pageIndex: number; readonly localFrameIndex: number } {
  const clip = definition.clips[phase];
  if (!Number.isSafeInteger(frameIndex) || frameIndex < 0 || frameIndex >= clip.frameCount) {
    throw new Error(`${phase} frame index is out of range: ${frameIndex}`);
  }
  const pageIndex = clip.pageIndexByFrame[frameIndex];
  if (pageIndex === undefined) {
    throw new Error(`${phase} frame ${frameIndex} has no manifest page index`);
  }
  const page = clip.pages[pageIndex];
  if (page === undefined) {
    throw new Error(`${phase} frame ${frameIndex} has no manifest page`);
  }
  return { page, pageIndex, localFrameIndex: frameIndex - page.firstFrameIndex };
}
