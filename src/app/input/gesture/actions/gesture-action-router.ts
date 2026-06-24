import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { GestureAdapter, GestureEvent } from "@/app/input/gesture/adapter";
import type {
  GestureActionContext,
  GestureActionRouterDispatchResult,
  GestureMappingModule,
} from "./types";

interface RegisteredGestureMappingModule<THost> {
  readonly module: GestureMappingModule<THost>;
  readonly order: number;
}

export interface GestureActionRouterOptions<THost = unknown> {
  readonly gestureAdapter: GestureAdapter;
  readonly workspace: WorkspaceContract;
  readonly getAppHost: () => THost;
  readonly modules?: readonly GestureMappingModule<THost>[];
}

const MODULE_PERF_LOG_WINDOW_MS = 10_000
// AI-REMOVED 2026-05-21:
// Reason: MODULE_PERF_TOP_COUNT 声明后未被任何代码引用，ESLint 报 no-unused-vars
// Trigger: lint error @typescript-eslint/no-unused-vars
// Evidence: grep 搜索仅命中声明行，无任何使用点
// Replacement: None（该常量从未被使用，仅声明）
// Risk: Low
// Human Review: Not Required
//
// Original code:
// const MODULE_PERF_TOP_COUNT = 10

interface ModulePerfWindow {
  startedAtMs: number
  eventCount: number
  timingsMs: Map<string, number>
}

function getRouterDebugMode(getAppHost: () => unknown): boolean {
  try {
    const host = getAppHost() as { internalState?: { settings?: { debugMode?: boolean } } }
    return host?.internalState?.settings?.debugMode === true
  } catch {
    return false
  }
}

export class GestureActionRouter<THost = unknown> {
  private readonly gestureAdapter: GestureAdapter;
  private readonly workspace: WorkspaceContract;
  private readonly getAppHost: () => THost;
  private readonly unsubscribeAdapter: () => void;
  private readonly modules = new Map<string, RegisteredGestureMappingModule<THost>>();
  private readonly dragClaims = new Map<string, string>();
  private nextModuleOrder = 0;
  private disposed = false;
  private modulePerfWindow: ModulePerfWindow | null = null;

  public constructor(options: GestureActionRouterOptions<THost>) {
    this.gestureAdapter = options.gestureAdapter;
    this.workspace = options.workspace;
    this.getAppHost = options.getAppHost;

    for (const module of options.modules ?? []) {
      this.registerModule(module);
    }

    this.unsubscribeAdapter = this.gestureAdapter.subscribe((event) => {
      return this.handleGesture(event);
    });

    this.modulePerfWindow = getRouterDebugMode(this.getAppHost)
      ? {
          startedAtMs: 0,
          eventCount: 0,
          timingsMs: new Map(),
        }
      : null
  }

  public registerModule(module: GestureMappingModule<THost>): () => void {
    this.assertActive();
    if (this.modules.has(module.id)) {
      throw new Error(`Gesture mapping module "${module.id}" is already registered.`);
    }

    this.modules.set(module.id, {
      module,
      order: this.nextModuleOrder,
    });
    this.nextModuleOrder += 1;

    return () => {
      this.unregisterModule(module.id);
    };
  }

  public unregisterModule(moduleId: string): void {
    this.modules.delete(moduleId);
    for (const [gestureId, ownerId] of this.dragClaims) {
      if (ownerId === moduleId) {
        this.dragClaims.delete(gestureId);
      }
    }
  }

  public replaceModules(modules: readonly GestureMappingModule<THost>[]): void {
    this.assertActive();
    this.modules.clear();
    this.dragClaims.clear();
    this.nextModuleOrder = 0;
    for (const module of modules) {
      this.registerModule(module);
    }
  }

  public getRegisteredModuleIds(): readonly string[] {
    return this.getSortedModules().map((entry) => entry.module.id);
  }

  public getDragClaimOwner(gestureId: string): string | null {
    return this.dragClaims.get(gestureId) ?? null;
  }

  public clearDragClaims(): void {
    this.dragClaims.clear();
  }

  private tryFlushModulePerf(perfWindow: ModulePerfWindow, nowMs: number): void {
    flushModulePerfLog(perfWindow, nowMs, getRouterDebugMode(this.getAppHost))
  }

  public handleGesture(event: GestureEvent): GestureActionRouterDispatchResult {
    if (this.disposed) {
      return emptyDispatchResult();
    }

    const perfWindow = this.modulePerfWindow
    const handleStartedAtMs = perfWindow !== null ? performance.now() : 0
    if (perfWindow !== null) {
      if (perfWindow.startedAtMs === 0) {
        perfWindow.startedAtMs = handleStartedAtMs
      }
      perfWindow.eventCount += 1
    }

    const existingClaimOwner = this.dragClaims.get(event.gestureId);
    if (existingClaimOwner !== undefined && isDragEvent(event)) {
      return this.dispatchToClaimOwner(event, existingClaimOwner);
    }

    const context = this.createContext();
    const handledBy: string[] = [];
    let claimedBy: string | null = null;

    for (const entry of this.getSortedModules()) {
      if (!this.moduleMatches(entry.module, context)) {
        continue;
      }

      const moduleStartedAtMs = perfWindow !== null ? performance.now() : 0
      const result = entry.module.handle(event, context);
      if (perfWindow !== null) {
        const moduleMs = performance.now() - moduleStartedAtMs
        const existing = perfWindow.timingsMs.get(entry.module.id) ?? 0
        perfWindow.timingsMs.set(entry.module.id, existing + moduleMs)
      }
      if (result.status === "ignored") {
        continue;
      }

      handledBy.push(entry.module.id);
      if (result.status === "claimed" && isDragStartEvent(event)) {
        if (!this.dragClaims.has(event.gestureId)) {
          this.dragClaims.set(event.gestureId, entry.module.id);
          claimedBy = entry.module.id;
        }
      }

      if (result.consume !== false || isActiveToolLifecycleEvent(event)) {
        if (perfWindow !== null) {
          this.tryFlushModulePerf(perfWindow, performance.now())
        }
        return {
          handledBy,
          consumedBy: entry.module.id,
          claimedBy,
        };
      }
    }

    if (perfWindow !== null) {
      this.tryFlushModulePerf(perfWindow, performance.now())
    }
    return {
      handledBy,
      consumedBy: null,
      claimedBy,
    };
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.unsubscribeAdapter();
    this.modules.clear();
    this.dragClaims.clear();
    this.disposed = true;
  }

  public queryLongPressAcceptance(gridHasEntity: boolean): boolean {
    if (this.disposed) {
      return false;
    }

    const context = this.createContext();
    for (const entry of this.getSortedModules()) {
      if (!this.moduleMatches(entry.module, context)) {
        continue;
      }

      if (entry.module.acceptsLongPress?.(context, gridHasEntity) === true) {
        return true;
      }
    }

    return false;
  }

  private dispatchToClaimOwner(
    event: GestureEvent,
    ownerId: string,
  ): GestureActionRouterDispatchResult {
    const perfWindow = this.modulePerfWindow
    const owner = this.modules.get(ownerId)?.module;
    if (owner === undefined) {
      if (isDragEndEvent(event)) {
        this.dragClaims.delete(event.gestureId);
      }
      return emptyDispatchResult();
    }

    const moduleStartedAtMs = perfWindow !== null ? performance.now() : 0
    const result = owner.handle(event, this.createContext());
    if (perfWindow !== null) {
      const moduleMs = performance.now() - moduleStartedAtMs
      const existing = perfWindow.timingsMs.get(ownerId) ?? 0
      perfWindow.timingsMs.set(ownerId, existing + moduleMs)
    }
    if (isDragEndEvent(event)) {
      this.dragClaims.delete(event.gestureId);
    }

    if (result.status === "ignored") {
      if (perfWindow !== null) {
        this.tryFlushModulePerf(perfWindow, performance.now())
      }
      return {
        handledBy: [],
        consumedBy: null,
        claimedBy: ownerId,
      };
    }

    if (perfWindow !== null) {
      this.tryFlushModulePerf(perfWindow, performance.now())
    }
    return {
      handledBy: [ownerId],
      consumedBy: result.consume === false ? null : ownerId,
      claimedBy: ownerId,
    };
  }

  private getSortedModules(): Array<RegisteredGestureMappingModule<THost>> {
    return Array.from(this.modules.values()).sort((left, right) => {
      const priorityDelta = (right.module.priority ?? 0) - (left.module.priority ?? 0);
      return priorityDelta === 0 ? left.order - right.order : priorityDelta;
    });
  }

  private moduleMatches(
    module: GestureMappingModule<THost>,
    context: GestureActionContext<THost>,
  ): boolean {
    return module.when?.(context) ?? true;
  }

  private createContext(): GestureActionContext<THost> {
    return {
      workspace: this.workspace,
      appHost: this.getAppHost(),
      keyboard: this.gestureAdapter.getKeyboardSnapshot(),
    };
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error("GestureActionRouter has been disposed.");
    }
  }
}

export function createGestureActionRouter<THost = unknown>(
  options: GestureActionRouterOptions<THost>,
): GestureActionRouter<THost> {
  return new GestureActionRouter(options);
}

function flushModulePerfLog(window: ModulePerfWindow, nowMs: number, debugMode: boolean): void {
  const windowMs = nowMs - window.startedAtMs
  if (windowMs < MODULE_PERF_LOG_WINDOW_MS) {
    return
  }

  const modules: Record<string, number> = {}
  for (const [id, totalMs] of window.timingsMs) {
    modules[id] = Math.round(totalMs * 100) / 100
  }

  if (debugMode) {
    console.debug("[gesture-module-perf] " + JSON.stringify({
      windowMs: Math.round(windowMs * 100) / 100,
      eventCount: window.eventCount,
      modules,
    }))
  }

  window.startedAtMs = nowMs
  window.eventCount = 0
  window.timingsMs.clear()
}

function isDragStartEvent(event: GestureEvent): boolean {
  return event.type === "mouse dragstart" || event.type === "touch dragstart";
}

function isDragEvent(event: GestureEvent): boolean {
  return (
    event.type === "mouse dragstart" ||
    event.type === "mouse dragmove" ||
    event.type === "mouse dragend" ||
    event.type === "touch dragstart" ||
    event.type === "touch dragmove" ||
    event.type === "touch dragend"
  );
}

function isDragEndEvent(event: GestureEvent): boolean {
  return event.type === "mouse dragend" || event.type === "touch dragend";
}

function isActiveToolLifecycleEvent(event: GestureEvent): boolean {
  return event.type === "on-enter-active-tool" || event.type === "on-exit-active-tool";
}

function emptyDispatchResult(): GestureActionRouterDispatchResult {
  return {
    handledBy: [],
    consumedBy: null,
    claimedBy: null,
  };
}
