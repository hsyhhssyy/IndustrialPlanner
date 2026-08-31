import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { GestureAdapter, GestureEvent } from "@/app/input/gesture/adapter";
import { SHORTCUT_ACTION_SPECS, type ShortcutKeyId } from "@/app/actions";
import type { ActiveTool } from "@/domain/app";
import type {
  GestureActionContext,
  GestureActionRouterDispatchResult,
  GestureMappingModule,
  KeyboardGestureEvent,
  ShortcutActionRoute,
  ShortcutInputLayer,
  ShortcutRouteConflict,
} from "./types";
import { DEBUG_PERFORMANCE_STATISTICS_PERIOD_MS } from "@/shared/debug-performance-statistics";
import {
  doesShortcutRouteMatchKeyboardEvent,
  shortcutScopesIntersect,
  shortcutTriggerSetsOverlap,
} from "./shortcut-route-matching";

interface RegisteredGestureMappingModule<THost> {
  readonly module: GestureMappingModule<THost>;
  readonly order: number;
}

export interface GestureActionRouterOptions<THost = unknown> {
  readonly gestureAdapter: GestureAdapter;
  readonly workspace: WorkspaceContract;
  readonly getAppHost: () => THost;
  readonly getShortcutBinding?: (shortcutId: ShortcutKeyId) => string;
  readonly getShortcutInputLayer?: (
    event: KeyboardGestureEvent,
    context: GestureActionContext<THost>,
  ) => ShortcutInputLayer;
  readonly getActiveTool?: (context: GestureActionContext<THost>) => ActiveTool;
  readonly modules?: readonly GestureMappingModule<THost>[];
}

const MODULE_PERF_LOG_WINDOW_MS = DEBUG_PERFORMANCE_STATISTICS_PERIOD_MS
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
  private readonly getShortcutBinding: ((shortcutId: ShortcutKeyId) => string) | null;
  private readonly getShortcutInputLayer: ((
    event: KeyboardGestureEvent,
    context: GestureActionContext<THost>,
  ) => ShortcutInputLayer) | null;
  private readonly getActiveTool: ((context: GestureActionContext<THost>) => ActiveTool) | null;
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
    this.getShortcutBinding = options.getShortcutBinding ?? null;
    this.getShortcutInputLayer = options.getShortcutInputLayer ?? null;
    this.getActiveTool = options.getActiveTool ?? null;

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

  public getRegisteredShortcutRoutes(): readonly ShortcutActionRoute<THost>[] {
    return this.getSortedModules().flatMap((entry) => entry.module.shortcutRoutes ?? []);
  }

  public findShortcutConflicts(options: {
    readonly shortcutId: ShortcutKeyId;
    readonly slotIndex: 0 | 1;
    readonly nextBinding: string;
  }): readonly ShortcutRouteConflict[] {
    if (this.getShortcutBinding === null || options.nextBinding === "") {
      return [];
    }

    const routes = this.getRegisteredShortcutRoutes();
    const targetRoutes = routes.filter((route) => (
      route.binding.kind === "configurable"
      && route.binding.shortcutId === options.shortcutId
    ));
    const conflicts = new Map<string, ShortcutRouteConflict>();

    for (const targetRoute of targetRoutes) {
      for (const conflictingRoute of routes) {
        if (!shortcutRouteEventsIntersect(targetRoute, conflictingRoute)) {
          continue;
        }
        if (!shortcutScopesIntersect(targetRoute.scope, conflictingRoute.scope)) {
          continue;
        }
        if (areShortcutRoutesExplicitlyComposable(targetRoute, conflictingRoute)) {
          continue;
        }

        if (conflictingRoute.binding.kind === "fixed") {
          if (!shortcutTriggerSetsOverlap({
            leftBinding: options.nextBinding,
            leftPolicy: targetRoute.triggerPolicy,
            rightBinding: conflictingRoute.binding.value,
            rightPolicy: conflictingRoute.triggerPolicy,
          })) {
            continue;
          }

          const key = `fixed:${conflictingRoute.id}`;
          upsertShortcutConflict(conflicts, key, {
            kind: "fixed",
            actionId: conflictingRoute.actionId,
            binding: conflictingRoute.binding.value,
            targetRouteId: targetRoute.id,
            conflictingRouteId: conflictingRoute.id,
            overlappingInputLayers: intersectValues(
              targetRoute.scope.inputLayers,
              conflictingRoute.scope.inputLayers,
            ),
            overlappingActiveTools: intersectValues(
              targetRoute.scope.activeTools,
              conflictingRoute.scope.activeTools,
            ),
          });
          continue;
        }

        const occupiedSlots = splitShortcutSlots(
          this.getShortcutBinding(conflictingRoute.binding.shortcutId),
        );
        for (const [slotIndex, occupiedBinding] of occupiedSlots.entries()) {
          if (
            conflictingRoute.binding.shortcutId === options.shortcutId
            && slotIndex === options.slotIndex
          ) {
            continue;
          }
          if (!shortcutTriggerSetsOverlap({
            leftBinding: options.nextBinding,
            leftPolicy: targetRoute.triggerPolicy,
            rightBinding: occupiedBinding,
            rightPolicy: conflictingRoute.triggerPolicy,
          })) {
            continue;
          }

          const normalizedSlotIndex = slotIndex as 0 | 1;
          const key = `configurable:${conflictingRoute.binding.shortcutId}:${normalizedSlotIndex}`;
          upsertShortcutConflict(conflicts, key, {
            kind: "configurable",
            actionId: conflictingRoute.actionId,
            binding: occupiedBinding,
            shortcutId: conflictingRoute.binding.shortcutId,
            slotIndex: normalizedSlotIndex,
            targetRouteId: targetRoute.id,
            conflictingRouteId: conflictingRoute.id,
            overlappingInputLayers: intersectValues(
              targetRoute.scope.inputLayers,
              conflictingRoute.scope.inputLayers,
            ),
            overlappingActiveTools: intersectValues(
              targetRoute.scope.activeTools,
              conflictingRoute.scope.activeTools,
            ),
          });
        }
      }
    }

    return Array.from(conflicts.values());
  }

  public assertShortcutRouteIntegrity(): void {
    const routes = this.getRegisteredShortcutRoutes();
    const routeIds = new Set<string>();
    const actionSpecById = new Map(SHORTCUT_ACTION_SPECS.map((spec) => [spec.id, spec]));
    const routedActionIds = new Set<string>();

    for (const route of routes) {
      if (routeIds.has(route.id)) {
        throw new Error(`Shortcut action route "${route.id}" is already registered.`);
      }
      routeIds.add(route.id);
      const actionSpec = actionSpecById.get(route.actionId);
      if (actionSpec === undefined) {
        throw new Error(`Shortcut action route "${route.id}" has no ActionSpec.`);
      }
      routedActionIds.add(route.actionId);

      if (route.binding.kind === "configurable") {
        if (!actionSpec.configurable || actionSpec.id !== route.binding.shortcutId) {
          throw new Error(`Shortcut action route "${route.id}" does not match its configurable ActionSpec.`);
        }
        continue;
      }

      if (actionSpec.configurable) {
        throw new Error(`Shortcut action route "${route.id}" does not match its fixed ActionSpec.`);
      }
      if (route.binding.value !== actionSpec.defaultBindings[0]) {
        throw new Error(
          `Fixed shortcut action route "${route.id}" binding does not match its ActionSpec.`,
        );
      }
    }

    const missing = SHORTCUT_ACTION_SPECS
      .map((spec) => spec.id)
      .filter((actionId) => !routedActionIds.has(actionId));
    if (missing.length > 0) {
      throw new Error(`Shortcut ActionSpec has no executable route: ${missing.join(", ")}`);
    }

    const defaultBindingByShortcutId = new Map(
      SHORTCUT_ACTION_SPECS
        .filter((spec) => spec.configurable)
        .map((spec) => [spec.id, spec.defaultBindings.join(";")]),
    );
    for (let leftIndex = 0; leftIndex < routes.length; leftIndex += 1) {
      const left = routes[leftIndex];
      if (left === undefined) continue;
      for (let rightIndex = leftIndex + 1; rightIndex < routes.length; rightIndex += 1) {
        const right = routes[rightIndex];
        if (right === undefined) continue;
        if (!shortcutRouteEventsIntersect(left, right)) continue;
        if (!shortcutScopesIntersect(left.scope, right.scope)) continue;
        if (areShortcutRoutesExplicitlyComposable(left, right)) continue;

        const leftBinding = left.binding.kind === "configurable"
          ? defaultBindingByShortcutId.get(left.binding.shortcutId) ?? ""
          : left.binding.value;
        const rightBinding = right.binding.kind === "configurable"
          ? defaultBindingByShortcutId.get(right.binding.shortcutId) ?? ""
          : right.binding.value;
        if (!shortcutTriggerSetsOverlap({
          leftBinding,
          leftPolicy: left.triggerPolicy,
          rightBinding,
          rightPolicy: right.triggerPolicy,
        })) {
          continue;
        }

        throw new Error(
          `Default shortcut routes conflict: "${left.id}" and "${right.id}".`,
        );
      }
    }
  }

  public claimsBrowserDefaultForKeyboardEvent(options: {
    readonly type: "key down" | "key up";
    readonly code: string | null;
    readonly key: string | null;
    readonly keyCode: number | null;
    readonly modifiers: {
      readonly alt: boolean;
      readonly ctrl: boolean;
      readonly meta: boolean;
      readonly shift: boolean;
    };
    readonly sourceEvent: unknown;
  }): boolean {
    if (
      this.disposed
      || this.getShortcutBinding === null
      || this.getShortcutInputLayer === null
      || this.getActiveTool === null
    ) {
      return false;
    }

    const event: KeyboardGestureEvent = {
      ...options,
      gestureId: "shortcut-browser-default-query",
    };
    const context = this.createContext();
    const inputLayer = this.getShortcutInputLayer(event, context);
    const activeTool = this.getActiveTool(context);

    return this.getSortedModules().some((entry) => {
      if (!this.moduleMatches(entry.module, context)) {
        return false;
      }

      return entry.module.shortcutRoutes?.some((route) => {
        if (route.claimsBrowserDefault !== true) return false;
        if (!(route.events ?? ["key down"]).includes(event.type)) return false;
        if (
          !route.scope.inputLayers.includes(inputLayer)
          || !route.scope.activeTools.includes(activeTool)
        ) {
          return false;
        }
        const binding = route.binding.kind === "configurable"
          ? this.getShortcutBinding?.(route.binding.shortcutId) ?? ""
          : route.binding.value;
        return doesShortcutRouteMatchKeyboardEvent({
          binding,
          triggerPolicy: route.triggerPolicy,
          event,
        });
      }) === true;
    });
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
      const result = this.handleModuleEvent(entry.module, event, context);
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

  private handleModuleEvent(
    module: GestureMappingModule<THost>,
    event: GestureEvent,
    context: GestureActionContext<THost>,
  ): ReturnType<GestureMappingModule<THost>["handle"]> {
    if (
      !isKeyboardGestureEvent(event)
      || module.shortcutRoutes === undefined
      || this.getShortcutBinding === null
      || this.getShortcutInputLayer === null
      || this.getActiveTool === null
    ) {
      return module.handle(event, context);
    }

    const inputLayer = this.getShortcutInputLayer(event, context);
    const activeTool = this.getActiveTool(context);
    let matchedRoute = false;

    for (const route of module.shortcutRoutes) {
      if (!(route.events ?? ["key down"]).includes(event.type)) {
        continue;
      }
      if (
        !route.scope.inputLayers.includes(inputLayer)
        || !route.scope.activeTools.includes(activeTool)
      ) {
        continue;
      }

      const binding = route.binding.kind === "configurable"
        ? this.getShortcutBinding(route.binding.shortcutId)
        : route.binding.value;
      if (!doesShortcutRouteMatchKeyboardEvent({
        binding,
        triggerPolicy: route.triggerPolicy,
        event,
      })) {
        continue;
      }

      matchedRoute = true;
      const result = route.handle(event, context);
      if (result.status !== "ignored") {
        return result;
      }
    }

    if (matchedRoute) {
      return { status: "ignored" };
    }

    return module.handle(event, context);
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

function isKeyboardGestureEvent(event: GestureEvent): event is KeyboardGestureEvent {
  return event.type === "key down" || event.type === "key up";
}

function shortcutRouteEventsIntersect<THost>(
  left: ShortcutActionRoute<THost>,
  right: ShortcutActionRoute<THost>,
): boolean {
  const leftEvents = left.events ?? ["key down"];
  const rightEvents = right.events ?? ["key down"];

  return leftEvents.some((eventType) => rightEvents.includes(eventType));
}

function areShortcutRoutesExplicitlyComposable<THost>(
  left: ShortcutActionRoute<THost>,
  right: ShortcutActionRoute<THost>,
): boolean {
  return left.composableWithActionIds?.includes(right.actionId) === true
    || right.composableWithActionIds?.includes(left.actionId) === true;
}

function splitShortcutSlots(value: string): readonly [string, string] {
  const [first = "", second = ""] = value.split(";", 2);

  return [first.trim(), second.trim()];
}

function upsertShortcutConflict(
  conflicts: Map<string, ShortcutRouteConflict>,
  key: string,
  nextConflict: ShortcutRouteConflict,
): void {
  const existing = conflicts.get(key);
  if (existing === undefined) {
    conflicts.set(key, nextConflict);
    return;
  }

  conflicts.set(key, {
    ...existing,
    overlappingInputLayers: mergeDistinctValues(
      existing.overlappingInputLayers,
      nextConflict.overlappingInputLayers,
    ),
    overlappingActiveTools: mergeDistinctValues(
      existing.overlappingActiveTools,
      nextConflict.overlappingActiveTools,
    ),
  });
}

function intersectValues<T>(left: readonly T[], right: readonly T[]): readonly T[] {
  const rightValues = new Set(right);
  return left.filter((value) => rightValues.has(value));
}

function mergeDistinctValues<T>(left: readonly T[], right: readonly T[]): readonly T[] {
  return Array.from(new Set([...left, ...right]));
}

function emptyDispatchResult(): GestureActionRouterDispatchResult {
  return {
    handledBy: [],
    consumedBy: null,
    claimedBy: null,
  };
}
