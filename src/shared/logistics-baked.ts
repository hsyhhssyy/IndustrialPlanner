import type { LogisticsMaterialShape } from './logistics-material';
import type { ItemDefinition } from '@/domain/registry/types/item-definition';

/** 烘焙贴图保持共享，流体颜色仅作为每条路线的材质参数。 */
export interface LogisticsBakedManifest {
  schemaVersion: 2;
  format: 'logistics-spritesheet-v2';
  resolution: number;
  pixelsPerCell: number;
  pages: Record<string, { file: string; width: number; height: number; data: boolean; sha256: string }>;
  frames: Record<string, {
    page: string; rect: [number, number, number, number];
    sourceSize: [number, number]; spriteSourceSize: [number, number, number, number];
  }>;
  clips: Record<string, { phaseSamples: number; frames: string[] }>;
  staticResources: Record<string, string>;
  parametersByResourceId: Record<string, Record<string, number>>;
  // AI-REMOVED 2026-09-14:
  // Reason: baked manifest 是物流纹理协议，不应复制 Registry 的物品视觉元数据。
  // Trigger: 用户要求 ItemDefinition.fluidColors 成为唯一运行时颜色来源。
  // Evidence: 当前公开 manifest 仅有 2 项，而独立美术表与 Registry 均覆盖 20 项。
  // Replacement: LogisticsPipeRoute.fluidColors，来源为 Registry ItemDefinition。
  // Risk: Low
  // Human Review: Required
  // Original code:
  // fluidProfiles: Record<string, { phase: 'liquid' | 'gas'; colors: Record<'body' | 'skin' | 'skin2' | 'splash', string> }>;
  cycle: { fillCellsPerSecond: number; drainDuration: number; refillDuration: number; edgeWidth: number };
  fluidPlayback: { referenceShader: { vertex: string; fragment: string } };
  endpointConnector: { composite: string; whitening: string };
}

export type PipeFluidPhase = 'empty' | 'head' | 'steady' | 'draining' | 'recovering';

export interface PipeFluidInput {
  itemId: string | null;
  firstOccupied: boolean;
  exact: boolean;
  length: number;
  closed: boolean;
  reset?: boolean;
}

/** 真实排空与视觉退场分开记忆；只有退场后观察到空管，才允许下一次首格进液产生水头。 */
export class PipeFluidPlayback {
  public phase: PipeFluidPhase = 'empty';
  public itemId: string | null = null;
  public thickness = 0;
  public head = 0;
  private initialized = false;
  private exact = false;
  private emptyConfirmed = false;
  private previousFirstOccupied = false;
  private previousActual: string | null = null;

  public update(input: PipeFluidInput, deltaSeconds: number, timing: LogisticsBakedManifest['cycle']): void {
    const delta = Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0);
    const rebuild = !this.initialized || input.reset || input.exact !== this.exact;
    if (rebuild) {
      this.phase = 'empty'; this.itemId = null; this.thickness = 0; this.head = 0;
      this.emptyConfirmed = input.itemId === null;
      this.previousActual = input.itemId;
      this.previousFirstOccupied = input.firstOccupied;
      this.initialized = true;
    }
    this.exact = input.exact;
    if (input.exact) {
      this.itemId = input.itemId;
      this.thickness = input.itemId === null ? 0 : 1;
      this.phase = input.itemId === null ? 'empty' : 'steady';
      this.head = input.length;
    } else {
      if (this.itemId !== null) {
        if (input.itemId !== this.itemId) this.phase = 'draining';
        else if (this.phase === 'draining') this.phase = 'recovering';
      } else if (input.itemId !== null) {
        const hasHead = !rebuild && this.emptyConfirmed && !input.closed
          && this.previousActual === null && !this.previousFirstOccupied && input.firstOccupied;
        this.itemId = input.itemId;
        this.phase = hasHead ? 'head' : 'recovering';
        this.thickness = hasHead ? 1 : 0;
        this.head = hasHead ? 0 : input.length;
        this.emptyConfirmed = false;
      }
      if (this.phase === 'draining') {
        this.thickness = Math.max(0, this.thickness - delta / timing.drainDuration);
        if (this.thickness === 0) {
          this.itemId = input.itemId;
          this.phase = input.itemId === null ? 'empty' : 'recovering';
          this.head = input.length;
          this.emptyConfirmed = input.itemId === null;
        }
      } else if (this.phase === 'recovering') {
        this.thickness = Math.min(1, this.thickness + delta / timing.refillDuration);
        // 中途恢复时不再保留旧水头边界。
        this.head = input.length;
        if (this.thickness === 1) this.phase = 'steady';
      } else if (this.phase === 'head') {
        this.head = Math.min(input.length, this.head + delta * timing.fillCellsPerSecond);
        if (this.head === input.length) this.phase = 'steady';
      }
      if (this.phase === 'empty' && input.itemId === null) this.emptyConfirmed = true;
    }
    this.previousActual = input.itemId;
    this.previousFirstOccupied = input.firstOccupied;
  }
}

export interface LogisticsPipeSegment {
  id: string; x: number; y: number; rotation: number; shape: LogisticsMaterialShape;
  start: number; support: boolean;
}

export interface LogisticsPipeRoute {
  id: string;
  segments: LogisticsPipeSegment[];
  closed: boolean;
  occupied: ReadonlySet<string>;
  exact: boolean;
  playback: PipeFluidPlayback;
  seconds: number;
  flowing: boolean;
  fluidColors: ItemDefinition['fluidColors'] | null;
  // AI-REMOVED 2026-09-14:
  // Reason: 路线不再缓存从 tag 或 manifest 解析出的单色副本。
  // Trigger: Registry.fluidColors 成为唯一运行时颜色来源。
  // Evidence: baked flow 已能按路线引用完整分层档案。
  // Replacement: fluidColors。
  // Risk: Low
  // Human Review: Required
  // Original code:
  // color: string;
  gas: boolean;
}
