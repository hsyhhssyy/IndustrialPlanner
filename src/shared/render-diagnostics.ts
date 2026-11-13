import { createSnapshotStore } from "./snapshot/snapshot-store";

export type RenderDiagnosticCondition = "full" | "without-belt-cargo" | "without-pipe-fluid" | "without-building-effects";
export type RenderDiagnosticMode = "automatic" | "manual";
export type RenderDiagnosticPhase = "warmup" | "stationary-before" | "pan" | "stationary-after" | "stopped-recovery";

export interface RenderDiagnosticWindow {
  readonly offsetMs: number;
  readonly durationMs: number;
  readonly frames: number;
  readonly fps: number;
  readonly sceneSyncMs: number | null;
  readonly pixiRenderMs: number | null;
}

export interface RenderDiagnosticMetric {
  readonly average: number;
  readonly maximum: number;
  readonly total: number;
}

export interface RenderDiagnosticFrame {
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
  readonly sceneSyncMs: number;
  readonly pixiRenderMs: number;
  readonly stages: Readonly<Record<string, number>>;
  readonly counts: Readonly<Record<string, number>>;
}

export interface RenderDiagnosticPhaseResult {
  readonly condition: RenderDiagnosticCondition;
  readonly repeatBaseline: boolean;
  readonly phase: Exclude<RenderDiagnosticPhase, "warmup">;
  readonly completed: boolean;
  readonly frames: number;
  readonly durationMs: number;
  readonly fps: number | null;
  readonly tailFps: number | null;
  readonly windows: readonly RenderDiagnosticWindow[];
  readonly averageFrameMs: number | null;
  readonly p95FrameMs: number | null;
  readonly maximumFrameMs: number | null;
  readonly longFrames: number;
  readonly viewportChangedFrames: number;
  readonly motionMatchesPhase: boolean;
  readonly sceneSync: RenderDiagnosticMetric;
  readonly pixiRender: RenderDiagnosticMetric;
  readonly stages: Readonly<Record<string, RenderDiagnosticMetric>>;
  readonly counts: Readonly<Record<string, RenderDiagnosticMetric>>;
}

export interface RenderDiagnosticReport {
  readonly schemaVersion: 2;
  readonly mode: RenderDiagnosticMode;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly status: "completed" | "cancelled";
  readonly reason: string | null;
  readonly environment: Readonly<Record<string, unknown>>;
  readonly phases: readonly RenderDiagnosticPhaseResult[];
  readonly baselineFrameTimeChangePercent: number | null;
}

export interface RenderDiagnosticProgress {
  readonly mode: RenderDiagnosticMode;
  readonly condition: RenderDiagnosticCondition;
  readonly repeatBaseline: boolean;
  readonly phase: RenderDiagnosticPhase;
  readonly group: number;
  readonly groups: number;
  readonly remainingSeconds: number;
}

export interface RenderDiagnosticState {
  readonly available: boolean;
  readonly progress: RenderDiagnosticProgress | null;
  readonly report: RenderDiagnosticReport | null;
  readonly error: string | null;
}

interface RenderDiagnosticControls {
  start(mode: RenderDiagnosticMode, condition: RenderDiagnosticCondition): void;
  cancel(): void;
}

export interface RenderDiagnosticSurface {
  beginProfile(): { restore(): void; environment: Record<string, unknown> };
  documentVersion(): number;
  setCondition(condition: RenderDiagnosticCondition): () => void;
}

export interface RenderDiagnosticFrameObserver {
  beforeFrame(nowMs: number): void;
  readonly collecting: boolean;
  record(frame: RenderDiagnosticFrame): void;
  disconnected(): void;
}

/** 临时诊断通道按 workspace 隔离；不写文档、用户设置或跨端同步数据。 */
// AI-CORRECTION 2026-11-12: 通道改按独立 View 隔离；App 拥有诊断操作，Renderer 只提供帧观测和图层控制。
function createRenderDiagnosticChannel() {
  const store = createSnapshotStore<RenderDiagnosticState>({ available: false, progress: null, report: null, error: null });
  let controls: RenderDiagnosticControls | null = null;
  let surface: RenderDiagnosticSurface | null = null;
  let observer: RenderDiagnosticFrameObserver | null = null;
  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    publish: store.setSnapshot,
    getSurface: (): RenderDiagnosticSurface | null => surface,
    beforeFrame: (nowMs: number): void => { observer?.beforeFrame(nowMs); },
    get collecting(): boolean { return observer?.collecting ?? false; },
    record: (frame: RenderDiagnosticFrame): void => { observer?.record(frame); },
    observeFrames(next: RenderDiagnosticFrameObserver): () => void {
      observer = next;
      return () => { if (observer === next) observer = null; };
    },
    attachSurface(next: RenderDiagnosticSurface): () => void {
      surface = next;
      store.setSnapshot({ ...store.getSnapshot(), available: controls !== null });
      return () => {
        if (surface !== next) return;
        observer?.disconnected();
        surface = null;
        store.setSnapshot({ ...store.getSnapshot(), available: false, progress: null });
      };
    },
    start(mode: RenderDiagnosticMode, condition: RenderDiagnosticCondition = "full"): void {
      controls?.start(mode, condition);
    },
    cancel(): void { controls?.cancel(); },
    connect(next: RenderDiagnosticControls): () => void {
      controls?.cancel();
      controls = next;
      store.setSnapshot({ ...store.getSnapshot(), available: surface !== null });
      return () => {
        if (controls !== next) return;
        controls.cancel();
        controls = null;
        store.setSnapshot({ ...store.getSnapshot(), available: false, progress: null });
      };
    },
  };
}

const channels = new WeakMap<object, ReturnType<typeof createRenderDiagnosticChannel>>();

export function getRenderDiagnosticChannel(workspace: object): ReturnType<typeof createRenderDiagnosticChannel> {
  let channel = channels.get(workspace);
  if (!channel) {
    channel = createRenderDiagnosticChannel();
    channels.set(workspace, channel);
  }
  return channel;
}
