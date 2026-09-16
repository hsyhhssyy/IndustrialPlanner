import type { Container } from "pixi.js";
import { getRenderDiagnosticChannel, type RenderDiagnosticCondition, type RenderDiagnosticFrame,
  type RenderDiagnosticMode, type RenderDiagnosticReport } from "@/shared/render-diagnostics";
import { resolveViewportVectorFromWorldVector, resolveWorldVectorFromViewportVector } from "@/shared/geometry/viewport-transform";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createRenderDiagnosticRun, resolveRenderDiagnosticBaselineChange } from "./render-diagnostic-run";

export function createRenderDiagnosticSession(options: {
  host: { workspace: WorkspaceContract };
  beginProfile: () => { restore: () => void; environment: Record<string, unknown> };
  layers: Record<Exclude<RenderDiagnosticCondition, "full">, Container>;
  documentVersion: () => number;
}) {
  const { host } = options;
  const channel = getRenderDiagnosticChannel(host.workspace);
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
    hidden: { target: Container; renderable: boolean } | null;
  } | null = null;
  let destroyed = false;

  const restoreLayer = (): void => {
    if (active?.hidden) {
      active.hidden.target.renderable = active.hidden.renderable;
      active.hidden = null;
    }
  };
  const applyCondition = (): void => {
    if (!active) return;
    restoreLayer();
    const condition = active.run.condition;
    if (condition !== "full") {
      const target = options.layers[condition];
      active.hidden = { target, renderable: target.renderable };
      // 保留 visible 及全部同步逻辑，仅持续禁止该根节点绘制，避免每帧切换制造结构失效。
      target.renderable = false;
    }
  };
  const moveTo = (center: { x: number; y: number }): void => {
    const editor = host.workspace.editor;
    if (!editor) return;
    const viewport = editor.state.viewport;
    const delta = resolveViewportVectorFromWorldVector({ worldVector: {
      x: (viewport.center.x - center.x) * viewport.gridCellPixelSize,
      y: (viewport.center.y - center.y) * viewport.gridCellPixelSize,
    }, displayRotation: viewport.displayRotation });
    if (Math.abs(delta.x) + Math.abs(delta.y) < 1e-8) return;
    editor.actions.moveViewportByClientPixelVector({ startClientPixel: { x: 0, y: 0 }, endClientPixel: delta });
  };
  const finish = (reason: string | null): void => {
    if (!active) return;
    const current = active;
    if (reason !== null) current.run.cancel(performance.now());
    restoreLayer();
    active = null;
    current.restoreProfile();
    const editor = host.workspace.editor;
    // 切换文档时不能把旧相机坐标写入新文档，也不能恢复用户主动改变的仿真状态。
    if (editor !== null && editor.document.getSnapshot().documentKey === current.documentKey
      && editor.document.getSnapshot().baseId === current.baseId) {
      moveTo(current.center);
      if (current.resume && !current.stoppedByDiagnostic && reason !== "simulation-changed" && reason !== "document-changed" && reason !== "renderer-destroyed"
        && host.workspace.simulation?.state.runningState === "pause") host.workspace.simulation.actions.resume();
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
    const editor = host.workspace.editor, app = host.workspace.app, simulation = host.workspace.simulation;
    const fail = (error: string): void => { channel.publish({ ...channel.getSnapshot(), error }); };
    if (!app?.state.settings.debugMode || !editor || !simulation) { fail("unavailable"); return; }
    if (simulation.state.runningState === "stop") { fail("simulation-stopped"); return; }
    if (app.state.activeTool !== "select" || editor.state.collections.preview.length > 0 || editor.state.collections.ghost.length > 0) { fail("select-tool-required"); return; }
    if (simulation.state.timeline.isSeeking) { fail("seeking"); return; }
    const viewport = editor.state.viewport;
    if (viewport.clientRect.width <= 0 || viewport.clientRect.height <= 0) { fail("unavailable"); return; }
    const profile = options.beginProfile();
    const resume = simulation.state.runningState === "start";
    if (resume) simulation.actions.pause();
    const now = performance.now();
    const run = createRenderDiagnosticRun(mode, condition, now);
    active = {
      run, mode, startedAt: new Date().toISOString(), documentVersion: options.documentVersion(),
      documentKey: editor.document.getSnapshot().documentKey, baseId: editor.document.getSnapshot().baseId,
      center: { ...viewport.center }, lastCenter: { ...viewport.center }, scale: viewport.gridCellPixelSize,
      rotation: viewport.displayRotation, width: viewport.clientRect.width, height: viewport.clientRect.height,
      resume, stoppedByDiagnostic: false, restoreProfile: profile.restore, nextPublishMs: 0, hidden: null,
      environment: {
        development: import.meta.env.DEV, mode: import.meta.env.MODE, userAgent: navigator.userAgent,
        version: (window as unknown as { __APP_VERSION__?: string }).__APP_VERSION__ ?? "unknown",
        screenProfile: { ...app.state.screenProfile }, ...profile.environment, entities: editor.queries.listEntities().length,
        originalRunningState: resume ? "start" : "pause", sampledRunningState: "pause",
        finalStageRunningState: mode === "automatic" ? "stop" : null, protocol: run.protocol,
        simulationSpeed: simulation.state.simulationSpeed,
        settings: { grass: app.state.settings.showGrassBackground, blueprintStyle: app.state.settings.gameUseBlueprintStyleDeviceImages,
          deviceAnimations: app.state.settings.gamePlayDeviceAnimations, exactFluidPosition: app.state.settings.gameShowPipeExactFluidPosition },
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

  return {
    beforeFrame(now: number): void {
      if (!active) return;
      try {
        const app = host.workspace.app, editor = host.workspace.editor, simulation = host.workspace.simulation;
        if (!app?.state.settings.debugMode) { finish("debug-disabled"); return; }
        if (!editor || options.documentVersion() !== active.documentVersion) { finish("document-changed"); return; }
        if (simulation?.state.runningState !== (active.stoppedByDiagnostic ? "stop" : "pause") || simulation.state.timeline.isSeeking) { finish("simulation-changed"); return; }
        const viewport = editor.state.viewport;
        if (viewport.gridCellPixelSize !== active.scale || viewport.displayRotation !== active.rotation
          || viewport.clientRect.width !== active.width || viewport.clientRect.height !== active.height) { finish("viewport-changed"); return; }
        if (app.state.activeTool !== "select") { finish("tool-changed"); return; }
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
      const center = host.workspace.editor!.state.viewport.center;
      active.run.record(frame, Math.abs(center.x - active.lastCenter.x) + Math.abs(center.y - active.lastCenter.y) > 1e-8);
      active.lastCenter = { ...center };
    },
    destroy(): void {
      destroyed = true; finish("renderer-destroyed"); disconnect();
      document.removeEventListener("visibilitychange", onHidden, true);
      window.removeEventListener("pagehide", onPageHide, true);
      hot?.off("vite:beforeUpdate", onHotUpdate);
    },
  };
}
