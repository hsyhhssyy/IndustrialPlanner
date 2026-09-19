import type { DeviceSpriteAnimationDefinition } from "../domain/registry";
import type { SimulationDeviceOperatingStatus } from "../domain/simulation";

/** AI-CORRECTION 2026-09-18: 四个名称现在只表示传统机械动画角色；正式 manifest 可包含任意显式 status 片段。 */
export const DEVICE_SPRITE_ANIMATION_PHASES = ["open", "open_idle", "close", "close_idle"] as const;
export const DEVICE_SPRITE_ANIMATION_STATUSES = [
  "closed",
  "idle",
  "normal",
  "blocked",
  "no-power",
  "not-in-power-net",
] as const satisfies readonly SimulationDeviceOperatingStatus[];
export const DEFAULT_DEVICE_SPRITE_FRAME_DURATION_MS = 100;
/** 离线发布的保守上限；运行时还须检查当前 GPU 的实际限制。 */
export const DEVICE_SPRITE_ANIMATION_MAX_TEXTURE_SIZE = 4096;
/** 兼容既有调用点的名称；值现在是 manifest 声明的任意安全片段 ID。 */
export type DeviceSpriteAnimationPhase = string;

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

export interface NormalizedDeviceSpriteAnimationClipPlayback {
  readonly playing: boolean;
  readonly restart: boolean;
  readonly loop: boolean;
}

export interface NormalizedDeviceSpriteAnimationSourceStatus {
  readonly statusKey: number;
  readonly clip: DeviceSpriteAnimationPhase;
  readonly playing: boolean;
  readonly restart: boolean;
}

export interface NormalizedDeviceSpriteAnimationDefinition {
  readonly clips: Readonly<Record<DeviceSpriteAnimationPhase, NormalizedDeviceSpriteAnimationClipDefinition>>;
  readonly clipIds: readonly DeviceSpriteAnimationPhase[];
  readonly playback: {
    readonly fallbackClip: DeviceSpriteAnimationPhase;
    readonly staticClip: DeviceSpriteAnimationPhase;
    readonly statusClips: Readonly<Partial<Record<SimulationDeviceOperatingStatus, DeviceSpriteAnimationPhase>>>;
    readonly openTransitionClip: DeviceSpriteAnimationPhase | null;
    readonly closeTransitionClip: DeviceSpriteAnimationPhase | null;
    readonly clipOptions: Readonly<Record<DeviceSpriteAnimationPhase, NormalizedDeviceSpriteAnimationClipPlayback>>;
    readonly sourceStatuses: Readonly<Record<string, NormalizedDeviceSpriteAnimationSourceStatus>>;
  };
  readonly closeIdleMode: DeviceSpriteAnimationDefinition["closeIdleMode"];
  readonly frameWidth: number;
  readonly frameHeight: number;
  /** 发布图片相对逻辑帧尺寸的像素密度，运行时只解码，不缩放。 */
  readonly resolution: number;
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

function requireClipId(value: unknown, label: string): DeviceSpriteAnimationPhase {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new Error(`${label} must be a safe clip ID`);
  }
  return value;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
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
  if (manifestSource.schemaVersion !== 2) {
    throw new Error("animation manifest.schemaVersion must be 2");
  }
  const frameWidth = requirePositiveInteger(manifestSource.frameWidth, "animation manifest.frameWidth");
  const frameHeight = requirePositiveInteger(manifestSource.frameHeight, "animation manifest.frameHeight");
  const resolution = manifestSource.resolution ?? 1;
  if (typeof resolution !== "number" || !Number.isFinite(resolution) || resolution <= 0 || resolution > 1) {
    throw new Error("animation manifest.resolution must be greater than 0 and at most 1");
  }
  requirePositiveInteger(frameWidth * resolution, "animation manifest pixel frameWidth");
  requirePositiveInteger(frameHeight * resolution, "animation manifest pixel frameHeight");
  const maskFile = requireAssetFile(manifestSource.maskFile, "animation manifest.maskFile");
  const sourceClips = requireRecord(manifestSource.clips, "animation manifest.clips");
  const clips = {} as Record<DeviceSpriteAnimationPhase, NormalizedDeviceSpriteAnimationClipDefinition>;
  const clipIds = Object.keys(sourceClips).map((clipId) => requireClipId(clipId, "animation manifest clip ID"));
  if (clipIds.length === 0) {
    throw new Error("animation manifest.clips must not be empty");
  }
  const pageFiles = new Set<string>();
  for (const phase of clipIds) {
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
  const playbackSource = requireRecord(manifestSource.playback, "animation manifest.playback");
  const requireExistingClip = (value: unknown, label: string): DeviceSpriteAnimationPhase => {
    const clipId = requireClipId(value, label);
    if (clips[clipId] === undefined) throw new Error(`${label} references an unknown clip: ${clipId}`);
    return clipId;
  };
  const fallbackClip = requireExistingClip(playbackSource.fallbackClip, "playback.fallbackClip");
  const staticClip = requireExistingClip(playbackSource.staticClip, "playback.staticClip");
  const statusClipSource = requireRecord(playbackSource.statusClips, "playback.statusClips");
  const supportedStatuses = new Set<string>(DEVICE_SPRITE_ANIMATION_STATUSES);
  const statusClips: Partial<Record<SimulationDeviceOperatingStatus, DeviceSpriteAnimationPhase>> = {};
  for (const [status, clip] of Object.entries(statusClipSource)) {
    if (!supportedStatuses.has(status)) throw new Error(`playback.statusClips has unsupported status: ${status}`);
    statusClips[status as SimulationDeviceOperatingStatus] = requireExistingClip(
      clip,
      `playback.statusClips.${status}`,
    );
  }
  const readTransition = (key: "openTransitionClip" | "closeTransitionClip") => (
    playbackSource[key] === undefined || playbackSource[key] === null
      ? null
      : requireExistingClip(playbackSource[key], `playback.${key}`)
  );
  const openTransitionClip = readTransition("openTransitionClip");
  const closeTransitionClip = readTransition("closeTransitionClip");
  const transitionClips = new Set([openTransitionClip, closeTransitionClip].filter((clip): clip is string => clip !== null));
  if (transitionClips.has(fallbackClip)) throw new Error("playback.fallbackClip cannot be a transition clip");
  for (const [status, clip] of Object.entries(statusClips)) {
    if (transitionClips.has(clip)) throw new Error(`playback.statusClips.${status} cannot be a transition clip`);
  }
  if (openTransitionClip !== null && statusClips.normal !== "open_idle") {
    throw new Error("playback.openTransitionClip requires normal to resolve to open_idle");
  }
  if (closeTransitionClip !== null && fallbackClip !== "close_idle") {
    throw new Error("playback.closeTransitionClip requires close_idle as fallback");
  }
  const clipOptionsSource = playbackSource.clipOptions === undefined
    ? {}
    : requireRecord(playbackSource.clipOptions, "playback.clipOptions");
  for (const clipId of Object.keys(clipOptionsSource)) {
    if (clips[clipId] === undefined) throw new Error(`playback.clipOptions references an unknown clip: ${clipId}`);
  }
  const clipOptions = Object.fromEntries(clipIds.map((clipId) => {
    const option = clipOptionsSource[clipId] === undefined
      ? {}
      : requireRecord(clipOptionsSource[clipId], `playback.clipOptions.${clipId}`);
    const isTransition = transitionClips.has(clipId);
    const playing = option.playing === undefined ? true : requireBoolean(option.playing, `${clipId}.playing`);
    const restart = option.restart === undefined ? true : requireBoolean(option.restart, `${clipId}.restart`);
    const loop = playing && !isTransition && !(clipId === "close_idle" && source.closeIdleMode === "hold-last");
    return [clipId, Object.freeze({ playing, restart, loop })];
  })) as Record<DeviceSpriteAnimationPhase, NormalizedDeviceSpriteAnimationClipPlayback>;
  const sourceStatusesSource = playbackSource.sourceStatuses === undefined
    ? {}
    : requireRecord(playbackSource.sourceStatuses, "playback.sourceStatuses");
  const sourceStatuses: Record<string, NormalizedDeviceSpriteAnimationSourceStatus> = {};
  for (const [code, value] of Object.entries(sourceStatusesSource)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(code)) throw new Error(`Invalid source status code: ${code}`);
    const item = requireRecord(value, `playback.sourceStatuses.${code}`);
    const statusKey = requirePositiveInteger(item.statusKey, `${code}.statusKey`);
    sourceStatuses[code] = Object.freeze({
      statusKey,
      clip: requireExistingClip(item.clip, `${code}.clip`),
      playing: requireBoolean(item.playing, `${code}.playing`),
      restart: requireBoolean(item.restart, `${code}.restart`),
    });
  }
  return Object.freeze({
    clips: Object.freeze(clips),
    clipIds: Object.freeze(clipIds),
    playback: Object.freeze({
      fallbackClip,
      staticClip,
      statusClips: Object.freeze(statusClips),
      openTransitionClip,
      closeTransitionClip,
      clipOptions: Object.freeze(clipOptions),
      sourceStatuses: Object.freeze(sourceStatuses),
    }),
    closeIdleMode: source.closeIdleMode,
    frameWidth,
    frameHeight,
    resolution,
    maskFile,
  });
}

export function resolveDeviceSpriteAnimationStatusClip(
  definition: NormalizedDeviceSpriteAnimationDefinition,
  status: SimulationDeviceOperatingStatus,
): DeviceSpriteAnimationPhase {
  return definition.playback.statusClips[status] ?? definition.playback.fallbackClip;
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
/** AI-CORRECTION 2026-09-12: 允许显式 resolution 表示位图缩放；清单和返回帧坐标仍为原逻辑尺寸，GPU 上限按实际像素校验。 */
/** AI-CORRECTION 2026-09-13: 分辨率以发布清单为准，传入纹理密度时必须一致。 */
export function resolveDeviceSpriteAnimationGrid(
  definition: NormalizedDeviceSpriteAnimationDefinition,
  page: DeviceSpriteAnimationManifestPage,
  dimensions: { readonly width: number; readonly height: number; readonly resolution?: number },
  maxTextureSize: number = DEVICE_SPRITE_ANIMATION_MAX_TEXTURE_SIZE,
): { readonly frameWidth: number; readonly frameHeight: number } {
  requirePositiveInteger(maxTextureSize, "maxTextureSize");
  const width = requirePositiveInteger(dimensions.width, `${page.file}.width`);
  const height = requirePositiveInteger(dimensions.height, `${page.file}.height`);
  const resolution = dimensions.resolution ?? definition.resolution;
  if (!Number.isFinite(resolution) || resolution <= 0) {
    throw new Error(`${page.file}.resolution must be positive and finite`);
  }
  if (resolution !== definition.resolution) {
    throw new Error(`${page.file}.resolution differs from its manifest`);
  }
  if (width >= maxTextureSize || height >= maxTextureSize) {
    throw new Error(`${page.file} must be smaller than GPU texture limit ${maxTextureSize}`);
  }
  if (width !== page.columns * definition.frameWidth * resolution
    || height !== page.rows * definition.frameHeight * resolution) {
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
  if (clip === undefined) {
    throw new Error(`Unknown animation clip: ${phase}`);
  }
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
