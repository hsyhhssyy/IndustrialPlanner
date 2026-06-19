/**
 * 内存快照工具 — 由 render-scene-orchestrator 每帧驱动，
 * 每 MEMORY_LOG_INTERVAL_MS 通过 onSnapshot 回调输出一次内存快照。
 */
import type { Application } from "pixi.js";

const MEMORY_LOG_INTERVAL_MS = 10_000;

/** Chrome 专用扩展属性 */
interface ChromePerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

export interface MemorySnapshot {
  timestamp: string;
  /** 距离上次快照的秒数 */
  elapsedSec: number;
  /** JS 堆已用 (MB) — Chrome only */
  jsHeapUsedMB: number | null;
  /** JS 堆总量 (MB) — Chrome only */
  jsHeapTotalMB: number | null;
  /** JS 堆上限 (MB) — Chrome only */
  jsHeapLimitMB: number | null;
  /** PixiJS renderer.texture 对象的 key 数量（粗略参考） */
  pixiTexturePoolKeys: number;
  /** 调用方注入的自定指标 */
  custom: Record<string, number>;
}

export interface MemorySnapshotCollector {
  /** 每帧调用，nowMs = Date.now()，内部判断是否满 10s 并触发 onSnapshot */
  tick(nowMs: number, customMetrics: Record<string, number>): void;
  /** 停止（重置计时，下次 tick 重新计时） */
  stop(): void;
}

export function createMemorySnapshotCollector(
  app: Application,
  onSnapshot: (snap: MemorySnapshot) => void,
): MemorySnapshotCollector {
  let lastLogAtMs = 0;

  return {
    tick(nowMs, customMetrics): void {
      if (lastLogAtMs === 0) {
        lastLogAtMs = nowMs;
        return;
      }

      const elapsedMs = nowMs - lastLogAtMs;
      if (elapsedMs < MEMORY_LOG_INTERVAL_MS) {
        return;
      }

      const snap = collectSnapshot(app, customMetrics, elapsedMs);
      lastLogAtMs = nowMs;
      onSnapshot(snap);
    },
    stop(): void {
      lastLogAtMs = 0;
    },
  };
}

function collectSnapshot(
  app: Application,
  customMetrics: Record<string, number>,
  elapsedMs: number,
): MemorySnapshot {
  let jsHeapUsedMB: number | null = null;
  let jsHeapTotalMB: number | null = null;
  let jsHeapLimitMB: number | null = null;

  const mem = (performance as unknown as { memory?: ChromePerformanceMemory }).memory;
  if (mem !== undefined) {
    jsHeapUsedMB = roundMB(mem.usedJSHeapSize);
    jsHeapTotalMB = roundMB(mem.totalJSHeapSize);
    jsHeapLimitMB = roundMB(mem.jsHeapSizeLimit);
  }

  let pixiTexturePoolKeys = 0;
  try {
    // PixiJS v8: renderer.texture 为纹理池对象，其 key 数量可作大致参考
    const texturePool = app.renderer.texture as unknown as Record<string, unknown>;
    pixiTexturePoolKeys = Object.keys(texturePool).length;
  } catch {
    // 忽略
  }

  return {
    timestamp: new Date().toISOString(),
    elapsedSec: roundSec(elapsedMs),
    jsHeapUsedMB,
    jsHeapTotalMB,
    jsHeapLimitMB,
    pixiTexturePoolKeys,
    custom: customMetrics,
  };
}

function roundMB(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

function roundSec(ms: number): number {
  return Math.round((ms / 1000) * 10) / 10;
}

