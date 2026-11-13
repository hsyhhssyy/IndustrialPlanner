import type { SimulationContract } from "@/domain/simulation/simulation-contract";
import { getRenderDiagnosticChannel, type RenderDiagnosticCondition, type RenderDiagnosticFrame,
  type RenderDiagnosticMode, type RenderDiagnosticReport } from "@/shared/render-diagnostics";
import { resolveViewportVectorFromWorldVector, resolveWorldVectorFromViewportVector } from "@/shared/geometry/viewport-transform";
import type { SceneViewInput } from "@/domain/document/scene-view-input";
import { createRenderDiagnosticRun, resolveRenderDiagnosticBaselineChange } from "@/shared/render-diagnostic-run";

export function createCanvasRenderDiagnosticSession(options: {
  readonly input: SceneViewInput;
  readonly simulation: SimulationContract | null;
}) {
  const host = options;
  const channel = getRenderDiagnosticChannel(host.input.camera);
  let active: {
    run: ReturnType<typeof createRenderDiagnosticRun>;
    mode: RenderDiagnosticMode;
    startedAt: string;
    environment: Record<string, unknown>;
    documentVersion: number;
    documentKey: string | undefined;
    baseId: string;
    center: { x: number; y: number };
    scale: number;
    rotation: 0 | 90 | 180 | 270;
    width: number;
    height: number;
    resume: boolean;
    stoppedByDiagnostic: boolean;
    restoreProfile: () => void;
    lastCenter: { x: number; y: number };
    nextPublishMs: number;
    restoreLayer: (() => void) | null;
  } | null = null;
  let destroyed = false;

// AI-REMOVED 2026-11-12:
// Reason: 诊断的相机与仿真写动作归 App owner，Renderer 只提供图层和帧观测。
// Trigger: REQ-048 D5/D6/A3。
// Evidence: 只读 SceneViewInput 无 Simulation.actions，预览不得控制主会话。
// Replacement: channel.getSurface().setCondition
// Risk: 诊断 owner 必须由装配层显式连接；Human Review: Required
// Original code:
//   const restoreLayer = (): void => {
//     if (active?.hidden) {
//       active.hidden.target.renderable = active.hidden.renderable;
//       active.hidden = null;
//     }
//   };
//   const applyCondition = (): void => {
//     if (!active) return;
//     restoreLayer();
//     const condition = active.run.condition;
//     if (condition !== "full") {
//       const target = options.layers[condition];
//       active.hidden = { target, renderable: target.renderable };
//       // 保留 visible 及全部同步逻辑，仅持续禁止该根节点绘制，避免每帧切换制造结构失效。
//       target.renderable = false;
//     }
//   };
// 
  const restoreLayer = (): void => { active?.restoreLayer?.(); if (active) active.restoreLayer = null; };
  const applyCondition = (): void => {
    if (!active) return;
    restoreLayer();
    active.restoreLayer = channel.getSurface()?.setCondition(active.run.condition) ?? null;
  };
  const moveTo = (center: { x: number; y: number }): void => {
    const source = host.input.source;
    if (!source) return;
    const viewport = host.input.camera.state;
    const delta = resolveViewportVectorFromWorldVector({ worldVector: {
      x: (viewport.center.x - center.x) * viewport.gridCellPixelSize,
      y: (viewport.center.y - center.y) * viewport.gridCellPixelSize,
    }, displayRotation: viewport.displayRotation });
    if (Math.abs(delta.x) + Math.abs(delta.y) < 1e-8) return;
    host.input.camera.actions.moveViewportByClientPixelVector({ startClientPixel: { x: 0, y: 0 }, endClientPixel: delta });
  };
  const finish = (reason: string | null): void => {
    if (!active) return;
    const current = active;
    if (reason !== null) current.run.cancel(performance.now());
    restoreLayer();
    active = null;
    current.restoreProfile();
    const source = host.input.source;
    // 切换文档时不能把旧相机坐标写入新文档，也不能恢复用户主动改变的仿真状态。
    if (source !== null && source.snapshot.getSnapshot().document.documentKey === current.documentKey
      && source.snapshot.getSnapshot().document.baseId === current.baseId) {
      moveTo(current.center);
      if (current.resume && !current.stoppedByDiagnostic && reason !== "simulation-changed" && reason !== "document-changed" && reason !== "renderer-destroyed"
        && options.simulation?.state.runningState === "pause") options.simulation.actions.resume();
    }
    const report: RenderDiagnosticReport = {
      schemaVersion: 2, mode: current.mode, startedAt: current.startedAt, finishedAt: new Date().toISOString(),
      status: reason === null ? "completed" : "cancelled", reason, environment: current.environment,
      phases: current.run.results, baselineFrameTimeChangePercent: resolveRenderDiagnosticBaselineChange(current.run.results),
    };
    channel.publish({ available: !destroyed, progress: null, report, error: reason });
    console.debug("[render-comparison] " + JSON.stringify(report));
  };
  const start = (mode: RenderDiagnosticMode, condition: RenderDiagnosticCondition): void => {
    if (active || destroyed) return;
    const source = host.input.source, app = host.input.presentation.getSnapshot(), simulation = options.simulation;
    const fail = (error: string): void => { channel.publish({ ...channel.getSnapshot(), error }); };
    if (!app.settings.debugMode || !source || !simulation) { fail("unavailable"); return; }
    if (simulation.state.runningState === "stop") { fail("simulation-stopped"); return; }
    if (app.activeTool !== "select" || (source.snapshot.getSnapshot().interaction?.collections.preview.length ?? 0) > 0 || (source.snapshot.getSnapshot().interaction?.collections.ghost.length ?? 0) > 0) { fail("select-tool-required"); return; }
    if (simulation.state.timeline.isSeeking) { fail("seeking"); return; }
    const viewport = host.input.camera.state;
    if (viewport.clientRect.width <= 0 || viewport.clientRect.height <= 0) { fail("unavailable"); return; }
    const surface = channel.getSurface();
    if (surface === null) { fail("unavailable"); return; }
    const profile = surface.beginProfile();
    const resume = simulation.state.runningState === "start";
    if (resume) simulation.actions.pause();
    const now = performance.now();
    const run = createRenderDiagnosticRun(mode, condition, now);
    active = {
      run, mode, startedAt: new Date().toISOString(), documentVersion: channel.getSurface()?.documentVersion() ?? -1,
      documentKey: source.snapshot.getSnapshot().document.documentKey, baseId: source.snapshot.getSnapshot().document.baseId,
      center: { ...viewport.center }, lastCenter: { ...viewport.center }, scale: viewport.gridCellPixelSize,
      rotation: viewport.displayRotation, width: viewport.clientRect.width, height: viewport.clientRect.height,
      resume, stoppedByDiagnostic: false, restoreProfile: profile.restore, nextPublishMs: 0, restoreLayer: null,
      environment: {
        development: import.meta.env.DEV, mode: import.meta.env.MODE, userAgent: navigator.userAgent,
        version: (window as unknown as { __APP_VERSION__?: string }).__APP_VERSION__ ?? "unknown",
        screenProfile: { ...app.screenProfile }, ...profile.environment, entities: source.queries.listEntities().length,
        originalRunningState: resume ? "start" : "pause", sampledRunningState: "pause",
        finalStageRunningState: mode === "automatic" ? "stop" : null, protocol: run.protocol,
        simulationSpeed: simulation.state.simulationSpeed,
        settings: { grass: app.settings.showGrassBackground, blueprintStyle: app.settings.gameUseBlueprintStyleDeviceImages,
          deviceAnimations: app.settings.gamePlayDeviceAnimations, exactFluidPosition: app.settings.gameShowPipeExactFluidPosition },
        viewport: { center: { ...viewport.center }, scale: viewport.gridCellPixelSize, rotation: viewport.displayRotation,
          width: viewport.clientRect.width, height: viewport.clientRect.height },
        panAmplitudeClientPixels: viewport.clientRect.width,
        panSpeedClientPixelsPerSecond: viewport.clientRect.width * 4_000 / run.protocol.panCycleMs,
        measurement: "main-thread-wall-ms; nested stages must not be added; GPU time only when supported",
      },
    };
    applyCondition();
    channel.publish({ available: true, progress: run.progress(now), report: null, error: null });
  };
  const disconnect = channel.connect({
    start: (mode, condition) => {
      try { start(mode, condition); }
      catch (error) {
        finish("capture-failed");
        channel.publish({ ...channel.getSnapshot(), error: "capture-failed" });
        console.error("[render-comparison] start failed", error);
      }
    },
    cancel: () => finish("user-cancelled"),
  });
  const onHidden = (): void => { if (document.visibilityState === "hidden") finish("page-hidden"); };
  const onPageHide = (): void => finish("page-hidden");
  // 在编辑器的冒泡阶段持久化监听器之前恢复相机，避免退出页面时保存测试途中的视口。
  // 2026-09-15 补充：原生 Window pagehide 仍按注册顺序触发，随后 visibilitychange 会刷新恢复后的视口。
  document.addEventListener("visibilitychange", onHidden, true);
  window.addEventListener("pagehide", onPageHide, true);
  const onHotUpdate = (): void => finish("environment-changed");
  const hot = typeof import.meta.hot?.off === "function" ? import.meta.hot : undefined;
  hot?.on("vite:beforeUpdate", onHotUpdate);

  const session = {
    beforeFrame(now: number): void {
      if (!active) return;
      try {
        const app = host.input.presentation.getSnapshot(), source = host.input.source, simulation = options.simulation;
        if (!app.settings.debugMode) { finish("debug-disabled"); return; }
        if (!source || (channel.getSurface()?.documentVersion() ?? -1) !== active.documentVersion) { finish("document-changed"); return; }
        if (simulation?.state.runningState !== (active.stoppedByDiagnostic ? "stop" : "pause") || simulation.state.timeline.isSeeking) { finish("simulation-changed"); return; }
        const viewport = host.input.camera.state;
        if (viewport.gridCellPixelSize !== active.scale || viewport.displayRotation !== active.rotation
          || viewport.clientRect.width !== active.width || viewport.clientRect.height !== active.height) { finish("viewport-changed"); return; }
        if (app.activeTool !== "select") { finish("tool-changed"); return; }
        const changed = active.run.advance(now);
        if (active.run.finished) { finish(null); return; }
        if (changed && active.run.phase === "warmup") { moveTo(active.center); applyCondition(); }
        if (changed && active.run.phase === "stopped-recovery") {
          restoreLayer();
          moveTo(active.center);
          // 正式 stop 会清空仿真进度，结束或取消时保持停止，不能用重新 start 冒充恢复原会话。
          active.stoppedByDiagnostic = true;
          active.environment.simulationStoppedAt = new Date().toISOString();
          simulation.actions.stop();
        }
        if (active.mode === "automatic") {
          const offset = resolveWorldVectorFromViewportVector({ viewportVector: {
            x: active.run.panOffset(now, active.width), y: 0,
          }, displayRotation: active.rotation });
          moveTo({ x: active.center.x + offset.x / active.scale, y: active.center.y + offset.y / active.scale });
        }
        if (changed || now >= active.nextPublishMs) {
          channel.publish({ ...channel.getSnapshot(), progress: active.run.progress(now) });
          active.nextPublishMs = now + 1_000;
        }
      } catch (error) {
        finish("capture-failed");
        console.error("[render-comparison] capture failed", error);
      }
    },
    get collecting(): boolean { return active !== null && active.run.phase !== "warmup"; },
    record(frame: RenderDiagnosticFrame): void {
      if (!active) return;
      const center = host.input.camera.state.center;
      active.run.record(frame, Math.abs(center.x - active.lastCenter.x) + Math.abs(center.y - active.lastCenter.y) > 1e-8);
      active.lastCenter = { ...center };
    },
    destroy(): void {
      destroyed = true; finish("renderer-destroyed"); disconnect(); stopObserving();
      document.removeEventListener("visibilitychange", onHidden, true);
      window.removeEventListener("pagehide", onPageHide, true);
      hot?.off("vite:beforeUpdate", onHotUpdate);
    },
  };
  const stopObserving = channel.observeFrames({
    beforeFrame: session.beforeFrame, record: session.record,
    get collecting() { return session.collecting; },
    disconnected: () => finish("renderer-destroyed"),
  });
  return session;
}
