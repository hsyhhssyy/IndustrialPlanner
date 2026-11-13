import { Application } from "pixi.js";
import { reaction } from "mobx";
import type { RenderContract, RenderViewHandle, RenderViewStatus, SceneViewUpdate } from "@/domain/renderer";
import type { SceneViewInput } from "@/domain/document/scene-view-input";
import type { SceneTimePolicy } from "@/domain/shared/scene-time";
import { SceneClock } from "@/shared/timing/scene-clock";
import { getRenderDiagnosticChannel } from "@/shared/render-diagnostics";
import { createRenderSceneOrchestrator } from "./scene/render-scene-orchestrator";
import { createTextureActions } from "./texture/texture-manager";
import { RenderResourceScope } from "./texture";
import { resolveRenderResolutionFromPresentation } from "./render-resolution";
import { resolveMainRendererAntialias } from "./pixi-render-diagnostics";
import { createRenderSurface, type RenderSurface } from "./surface";
import type { RenderSurfaceContext } from "./render-surface-context";
import "./renderer-host.css";

export type RenderHost = RenderContract;
interface RenderHostDomElements {
  placementGlowOverlay: HTMLDivElement;
  blueprintGlowOverlay: HTMLDivElement;
  marqueeGlowOverlay: HTMLDivElement;
}

interface ViewEntry {
  readonly handle: RenderViewHandle;
  readonly input: SceneViewInput;
  readonly clock: SceneClock;
  readonly resources: RenderResourceScope;
  readonly cleanups: (() => void)[];
  time: SceneTimePolicy;
  phase: RenderViewStatus["phase"];
  dirty: boolean;
  suspensions: number;
  surface: RenderSurface | null;
  container: HTMLDivElement | null;
}

interface RoundPixelsStageLike {
  roundPixels: boolean;
}

const DEFAULT_VIEWPORT_WIDTH = 800;
const DEFAULT_VIEWPORT_HEIGHT = 600;

function resolveViewportAxisSize(
  value: number,
  fallback: number,
): number {
  if (!Number.isFinite(value) || value < 0) {
    return fallback;
  }

  return Math.floor(value);
}

function createRendererContainer(app: Application): {
  container: HTMLDivElement;
  dom: RenderHostDomElements;
} {
  const container = document.createElement("div");
  container.className = "industrial-planner-renderer";

  app.canvas.classList.add("industrial-planner-renderer__canvas");

  const placementGlowOverlay = document.createElement("div");
  placementGlowOverlay.className = [
    "industrial-planner-renderer__glow-overlay",
    "industrial-planner-renderer__placement-glow",
  ].join(" ");

  const blueprintGlowOverlay = document.createElement("div");
  blueprintGlowOverlay.className = [
    "industrial-planner-renderer__glow-overlay",
    "industrial-planner-renderer__blueprint-glow",
  ].join(" ");

  const marqueeGlowOverlay = document.createElement("div");
  marqueeGlowOverlay.className = [
    "industrial-planner-renderer__glow-overlay",
    "industrial-planner-renderer__marquee-glow",
  ].join(" ");

  container.append(app.canvas, placementGlowOverlay, blueprintGlowOverlay, marqueeGlowOverlay);

  return {
    container,
    dom: {
      placementGlowOverlay,
      blueprintGlowOverlay,
      marqueeGlowOverlay,
    },
  };
}


/** 构造无浏览器副作用；只有显式 mountView 才创建 Pixi Application。 */
export function createRenderHost(): RenderHost {
  const entries = new Map<RenderViewHandle, ViewEntry>();
  const listeners = new Set<() => void>();
  let serial = 0;
  let destroyed = false;
  let updating = false;
  const queued: SceneViewUpdate[] = [];

  const notify = (): void => {
    for (const listener of [...listeners]) {
      try { listener(); } catch (error) { console.error("Render demand listener failed", error); }
    }
  };
  const invalidate = (entry: ViewEntry): void => {
    if (entry.phase === "disposed") return;
    entry.dirty = true;
    notify();
  };
  const dispose = (entry: ViewEntry): void => {
    if (entry.phase === "disposed") return;
    entry.phase = "disposed";
    entries.delete(entry.handle);
    const errors: unknown[] = [];
    for (const cleanup of entry.cleanups.splice(0).reverse()) {
      try { cleanup(); } catch (error) { errors.push(error); }
    }
    entry.resources.dispose();
    try { entry.surface?.destroy(); } catch (error) { errors.push(error); }
    entry.surface = null;
    entry.container?.remove();
    entry.container = null;
    notify();
    for (const error of errors) console.error("Scene view cleanup failed", error);
  };
  const checkLive = (entry: ViewEntry): void => {
    if (destroyed || entry.phase === "disposed" || entry.input.source.snapshot.getSnapshot().disposed) {
      throw new DOMException("Scene view disposed during initialization", "AbortError");
    }
  };
  const needsContinuousFrame = (entry: ViewEntry): boolean => {
    if (entry.phase !== "ready" || entry.time.kind === "fixed") return false;
    const { camera, source, presentation } = entry.input;
    if (camera.state.clientRect.width <= 0 || camera.state.clientRect.height <= 0) return false;
    if (camera.queries.hasPendingMotion()) return true;
    if (entry.surface?.needsContinuousFrame()) return true;
    if (getRenderDiagnosticChannel(camera).getSnapshot().progress !== null) return true;
    const snapshot = source.snapshot.getSnapshot();
    const collections = snapshot.interaction?.collections;
    if ((collections?.selection.length ?? 0) > 0 || (collections?.preview.length ?? 0) > 0) return true;
    const settings = presentation.getSnapshot().settings;
    if (settings.gameUseBlueprintStyleDeviceImages) return false;
    return source.queries.listEntities().some((entity) => {
      const definition = source.registry.queries.findEntityDefinition(entity.definitionId);
      return definition?.spriteAnimation !== undefined && settings.gamePlayDeviceAnimations
        || source.registry.queries.isBeltLogistics(entity.definitionId)
        || source.registry.queries.isPipeLogistics(entity.definitionId);
    });
  };
  const draw = (entry: ViewEntry, deltaMs: number): void => {
    if (entry.surface === null || entry.phase === "disposed" || entry.phase === "suspended") return;
    entry.dirty = false;
    try {
      entry.surface.renderFrame({ nowMs: entry.clock.sampleTimeMs, deltaMs });
    } catch (error) { entry.dirty = true; throw error; }
  };

  return {
    actions: {
      async mountView(options) {
        if (destroyed) throw new Error("Renderer disposed");
        if (options.signal?.aborted) throw options.signal.reason ?? new DOMException("Mount aborted", "AbortError");
        if (options.input.source.snapshot.getSnapshot().disposed) throw new Error("Scene source disposed");
        const handle = options.input.id + ":" + (++serial);
        const clock = new SceneClock(options.time);
        const entry: ViewEntry = {
          handle, input: options.input, clock, time: options.time,
          resources: new RenderResourceScope(() => invalidate(entry)), cleanups: [],
          phase: "initializing", dirty: true, suspensions: 0, surface: null, container: null,
        };
        entries.set(handle, entry);
        const abort = (): void => dispose(entry);
        options.signal?.addEventListener("abort", abort, { once: true });
        entry.cleanups.push(() => options.signal?.removeEventListener("abort", abort));
        let app: Application | null = null;
        let initialized = false;
        let surfaceOwnsResources = false;
        let textures: ReturnType<typeof createTextureActions> | null = null;
        try {
          const stopSource = entry.input.source.snapshot.subscribe((snapshot) => {
            if (snapshot.disposed) dispose(entry); else invalidate(entry);
          });
          if (entry.phase === "disposed") stopSource(); else entry.cleanups.push(stopSource);
          checkLive(entry);
          app = new Application();
          checkLive(entry);
          const initial = entry.input.presentation.getSnapshot();
          const rect = entry.input.camera.state.clientRect;
          await app.init({
            width: Math.max(1, resolveViewportAxisSize(rect.width, DEFAULT_VIEWPORT_WIDTH)),
            height: Math.max(1, resolveViewportAxisSize(rect.height, DEFAULT_VIEWPORT_HEIGHT)),
            backgroundAlpha: 0, antialias: resolveMainRendererAntialias(initial.settings.debugMode),
            autoDensity: true, autoStart: false, resolution: resolveRenderResolutionFromPresentation(initial), preference: "webgl",
          });
          initialized = true;
          const initializedApp = app;
          checkLive(entry);
          (app.stage as unknown as RoundPixelsStageLike).roundPixels = true;
          const dom = createRendererContainer(app);
          entry.container = dom.container;
          const internalState = { textureConfig: null as unknown | null };
          textures = createTextureActions({ renderer: app.renderer, presentation: entry.input.presentation,
            resources: entry.resources, syncTextureConfigState: (value) => { internalState.textureConfig = value; } });
          const context: RenderSurfaceContext = { input: entry.input, app, container: dom.container, dom: dom.dom,
            textureManager: textures, internalState, resources: entry.resources, invalidate: () => invalidate(entry) };
          const scene = createRenderSceneOrchestrator(context, textures.performanceDiagnostics);
          const ownedTextures = textures;
          entry.surface = createRenderSurface({ id: handle, app, scene,
            // Pixi 的 boolean true 同时释放全局资源池；单视图销毁必须保留其他 Application 的批次。
            destroyResources: () => { try { ownedTextures.destroy(); } finally { initializedApp.destroy({ removeView: true, releaseGlobalResources: false }, { children: true }); } } });
          surfaceOwnsResources = true;
          const wake = (): void => invalidate(entry);
          entry.cleanups.push(getRenderDiagnosticChannel(entry.input.camera).subscribe(wake));
          entry.cleanups.push(entry.input.presentation.subscribe(wake), entry.input.overlay.subscribe(wake));
          entry.cleanups.push(reaction(() => [JSON.stringify(entry.input.camera.state), entry.input.camera.queries.hasPendingMotion()], wake));
          if (entry.input.simulation !== null) {
            entry.cleanups.push(reaction(() => {
              const simulation = entry.input.simulation!;
              return [simulation.state.runningState, simulation.state.timeline?.cursorTickNumber,
                simulation.state.timeline?.readiness, simulation.state.timeline?.isSeeking,
                simulation.queries.getDocumentRuntimeStatus?.()?.tickNumber];
            }, wake));
          }
          app.canvas.addEventListener("webglcontextrestored", wake);
          entry.cleanups.push(() => initializedApp.canvas.removeEventListener("webglcontextrestored", wake));
          if (document.fonts !== undefined) {
            document.fonts.addEventListener("loadingdone", wake);
            entry.cleanups.push(() => document.fonts.removeEventListener("loadingdone", wake));
            entry.resources.track(document.fonts.ready);
          }
          // 每轮同步可能发现新的资源（manifest → atlas → 当前帧），收敛后才交付首屏。
          do {
            checkLive(entry);
            draw(entry, 0);
            await entry.resources.waitForIdle();
            await Promise.resolve();
          } while (entry.dirty || entry.resources.loading);
          checkLive(entry);
          entry.phase = entry.suspensions > 0 ? "suspended" : "ready";
          notify();
          return handle;
        } catch (error) {
          dispose(entry);
          if (!surfaceOwnsResources) {
            try { textures?.destroy(); } finally {
              if (app !== null) {
                if (initialized) app.destroy({ removeView: true, releaseGlobalResources: false }, { children: true });
                else {
                  // init 在 renderer 或插件阶段抛错时仍释放已经建立的资源。
                  app.stage?.destroy({ children: true });
                  app.renderer?.destroy({ removeView: true, releaseGlobalResources: false });
                }
              }
            }
          }
          throw error;
        }
      },
      updateViews(updates) {
        if (destroyed) return;
        queued.push(...updates);
        if (updating) return;
        updating = true;
        try {
          while (queued.length > 0) {
            const update = queued.shift()!;
            const entry = entries.get(update.handle);
            if (entry === undefined || entry.phase !== "ready") continue;
            const deltaMs = entry.clock.update(update.sample);
            if (deltaMs > 0) entry.input.camera.actions.advance(deltaMs);
            if (entry.dirty || deltaMs > 0) draw(entry, deltaMs);
          }
        } finally { updating = false; }
      },
      invalidateView(handle) { const entry = entries.get(handle); if (entry !== undefined) invalidate(entry); },
      setViewTimePolicy(handle, policy) {
        const entry = entries.get(handle);
        if (entry === undefined) return;
        entry.clock.setPolicy(policy);
        entry.time = { ...policy };
        invalidate(entry);
      },
      suspendView(handle) {
        const entry = entries.get(handle);
        if (entry === undefined || entry.phase === "disposed") return () => {};
        entry.suspensions += 1;
        if (entry.phase === "ready") entry.phase = "suspended";
        entry.clock.resetBaseline();
        notify();
        let released = false;
        return () => {
          if (released || entry.phase === "disposed") return;
          released = true;
          entry.suspensions -= 1;
          if (entry.suspensions === 0) {
            if (entry.phase === "suspended") entry.phase = "ready";
            entry.clock.resetBaseline(); invalidate(entry);
          }
        };
      },
      disposeView(handle) { const entry = entries.get(handle); if (entry !== undefined) dispose(entry); },
    },
    queries: {
      getViewContainer: (handle) => entries.get(handle)?.container ?? null,
      getViewCanvas: (handle) => entries.get(handle)?.surface?.canvas ?? null,
      getViewStatus(handle) {
        const entry = entries.get(handle);
        return entry === undefined ? null : { phase: entry.phase, sampleTimeMs: entry.clock.sampleTimeMs,
          dirty: entry.dirty, needsContinuousFrame: needsContinuousFrame(entry) };
      },
      subscribeFrameDemand(listener) { if (destroyed) return () => {}; listeners.add(listener); return () => { listeners.delete(listener); }; },
    },
    destroy() { if (destroyed) return; destroyed = true; for (const entry of [...entries.values()]) dispose(entry); listeners.clear(); },
  };
}

// AI-REMOVED 2026-11-12:
// Reason: 主画布和预览统一为显式挂载的 View；Renderer 不持有 Workspace、帧循环和仿真推进权。
// Trigger: REQ-048 D5/D6 与 A2/A3。
// Evidence: 旧 scheduler 会驱动所有预览，旧预览依赖伪造 Editor。
// Replacement: createRenderHost / mountView / updateViews
// Risk: 装配层必须负责驱动、播放和销毁。
// Human Review: Required
// Original code:
// import type { RenderAction, RenderContract, RenderQuery } from "@/domain/renderer";
// import type { WorkspaceContract } from "@/domain/document/workspace-contract";
//
// import { Application } from "pixi.js";
// import { createBlueprintPreviewManager } from "./blueprint-preview/blueprint-preview-manager";
// import { resolveRenderResolutionFromApp } from "./render-resolution";
// import { resolveMainRendererAntialias } from "./pixi-render-diagnostics";
// import {
//   createRenderSceneOrchestrator,
//   type RenderSceneOrchestrator,
// } from "./scene/render-scene-orchestrator";
// import {
//   createTextureActions,
// } from "./texture/texture-manager";
// import type { RenderSurfaceContext } from "./render-surface-context";
// import {
//   createRenderScheduler,
//   createRenderSurface,
//   createRenderSurfaceRegistry,
// } from "./surface";
// import "./renderer-host.css";
//
// interface RenderHostDomElements {
//   placementGlowOverlay: HTMLDivElement;
//   blueprintGlowOverlay: HTMLDivElement;
//   marqueeGlowOverlay: HTMLDivElement;
// }
//
// export interface RenderHost extends RenderContract, RenderSurfaceContext {
//   workspace: WorkspaceContract;
//   app: Application;
//   dom: RenderHostDomElements;
//   textureManager: ReturnType<typeof createTextureActions>;
//   internalState: {
//     textureConfig: unknown | null;
//   };
// }
//
// interface RoundPixelsStageLike {
//   roundPixels: boolean;
// }
//
// const DEFAULT_VIEWPORT_WIDTH = 800;
// const DEFAULT_VIEWPORT_HEIGHT = 600;
//
// function resolveViewportAxisSize(
//   value: number,
//   fallback: number,
// ): number {
//   if (!Number.isFinite(value) || value < 0) {
//     return fallback;
//   }
//
//   return Math.floor(value);
// }
//
// function createRendererContainer(app: Application): {
//   container: HTMLDivElement;
//   dom: RenderHostDomElements;
// } {
//   const container = document.createElement("div");
//   container.className = "industrial-planner-renderer";
//
//   app.canvas.classList.add("industrial-planner-renderer__canvas");
//
//   const placementGlowOverlay = document.createElement("div");
//   placementGlowOverlay.className = [
//     "industrial-planner-renderer__glow-overlay",
//     "industrial-planner-renderer__placement-glow",
//   ].join(" ");
//
//   const blueprintGlowOverlay = document.createElement("div");
//   blueprintGlowOverlay.className = [
//     "industrial-planner-renderer__glow-overlay",
//     "industrial-planner-renderer__blueprint-glow",
//   ].join(" ");
//
//   const marqueeGlowOverlay = document.createElement("div");
//   marqueeGlowOverlay.className = [
//     "industrial-planner-renderer__glow-overlay",
//     "industrial-planner-renderer__marquee-glow",
//   ].join(" ");
//
//   container.append(app.canvas, placementGlowOverlay, blueprintGlowOverlay, marqueeGlowOverlay);
//
//   return {
//     container,
//     dom: {
//       placementGlowOverlay,
//       blueprintGlowOverlay,
//       marqueeGlowOverlay,
//     },
//   };
// }
//
//
// export async function createRenderHost(
//   workspace: WorkspaceContract,
//   options: { showBaseBoundary?: boolean } = {},
// ): Promise<RenderHost> {
//   const editor = workspace.editor;
//   if (editor === null) {
//     throw new Error("Editor host must be initialized before render host.");
//   }
//
//   const app = new Application();
//   const { clientRect } = editor.state.viewport;
//   const renderResolution = resolveRenderResolutionFromApp(workspace.app);
//   const renderAntialias = resolveMainRendererAntialias(
//     workspace.app?.state.settings?.debugMode === true,
//   );
//
//   await app.init({
//     width: resolveViewportAxisSize(clientRect.width, DEFAULT_VIEWPORT_WIDTH),
//     height: resolveViewportAxisSize(clientRect.height, DEFAULT_VIEWPORT_HEIGHT),
//     backgroundAlpha: 0,
//     antialias: renderAntialias,
//     autoDensity: true,
//     autoStart: false,
//     resolution: renderResolution,
//     preference: "webgl",
//   });
//
//   (app.stage as unknown as RoundPixelsStageLike).roundPixels = true;
//   const internalState: RenderHost["internalState"] = {
//     textureConfig: null,
//   };
//   const rendererDom = createRendererContainer(app);
//   const surfaceRegistry = createRenderSurfaceRegistry();
//   const textureManager = createTextureActions({
//     renderer: app.renderer,
//     app: workspace.app,
//     syncTextureConfigState: (textureConfig) => {
//       internalState.textureConfig = textureConfig;
//     },
//   });
//   const actions = {} as RenderAction;
//   const queries = {} as RenderQuery;
//   const scheduler = createRenderScheduler({
//     listActiveSurfaces: surfaceRegistry.listActive,
//     advanceHostFrame: (frameTime) => {
//       void workspace.simulation?.actions.advancePlaybackByDeltaMs(frameTime.deltaMs)
//     },
//   });
//   let blueprintPreviewManager: ReturnType<typeof createBlueprintPreviewManager> | null = null;
//   let destroyed = false;
//
//   const host: RenderHost = {
//     showBaseBoundary: options.showBaseBoundary,
//     workspace,
//     app,
//     container: rendererDom.container,
//     dom: rendererDom.dom,
//     textureManager,
//     internalState,
//     queries,
//     actions,
//     destroy: () => {
//       if (destroyed) {
//         return;
//       }
//       destroyed = true;
//       scheduler.destroy();
//       try {
//         blueprintPreviewManager?.destroy();
//       } finally {
//         blueprintPreviewManager = null;
//         try {
//           surfaceRegistry.destroy();
//         } finally {
//           rendererDom.container.remove();
//           if (workspace.render === host) {
//             workspace.render = null;
//           }
//         }
//       }
//     },
//   };
//
//   blueprintPreviewManager = createBlueprintPreviewManager({
//     workspace,
//     surfaceRegistry,
//   });
//   Object.assign(actions, blueprintPreviewManager.actions);
//   Object.assign(queries, blueprintPreviewManager.queries);
//
//   let mainSurfaceOwnsResources = false;
//   try {
//     const orchestrator: RenderSceneOrchestrator = createRenderSceneOrchestrator(
//       host,
//       textureManager.performanceDiagnostics,
//     );
//     surfaceRegistry.beginInitializing("main");
//     const mainSurface = createRenderSurface({
//       id: "main",
//       app,
//       scene: orchestrator,
//       destroyResources: () => {
//         textureManager.destroy();
//         app.destroy();
//       },
//     });
//     mainSurfaceOwnsResources = true;
//     if (!surfaceRegistry.activate(mainSurface)) {
//       throw new Error("Main render surface was disposed during initialization.");
//     }
//
//     workspace.render = host;
//     scheduler.start();
//     return host;
//   } catch (error) {
//     scheduler.destroy();
//     blueprintPreviewManager?.destroy();
//     blueprintPreviewManager = null;
//     surfaceRegistry.destroy();
//     if (!mainSurfaceOwnsResources) {
//       textureManager.destroy();
//       app.destroy();
//     }
//     rendererDom.container.remove();
//     throw error;
//   }
// }
//
