import type { WorkspaceContract } from "@/domain/contract/workspace-contract";
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

export class GestureActionRouter<THost = unknown> {
  private readonly gestureAdapter: GestureAdapter;
  private readonly workspace: WorkspaceContract;
  private readonly getAppHost: () => THost;
  private readonly unsubscribeAdapter: () => void;
  private readonly modules = new Map<string, RegisteredGestureMappingModule<THost>>();
  private readonly dragClaims = new Map<string, string>();
  private nextModuleOrder = 0;
  private disposed = false;

  public constructor(options: GestureActionRouterOptions<THost>) {
    this.gestureAdapter = options.gestureAdapter;
    this.workspace = options.workspace;
    this.getAppHost = options.getAppHost;

    for (const module of options.modules ?? []) {
      this.registerModule(module);
    }

    this.unsubscribeAdapter = this.gestureAdapter.subscribe((event) => {
      this.handleGesture(event);
    });
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

  public handleGesture(event: GestureEvent): GestureActionRouterDispatchResult {
    if (this.disposed) {
      return emptyDispatchResult();
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

      const result = entry.module.handle(event, context);
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

      if (result.consume !== false) {
        return {
          handledBy,
          consumedBy: entry.module.id,
          claimedBy,
        };
      }
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

  private dispatchToClaimOwner(
    event: GestureEvent,
    ownerId: string,
  ): GestureActionRouterDispatchResult {
    const owner = this.modules.get(ownerId)?.module;
    if (owner === undefined) {
      if (isDragEndEvent(event)) {
        this.dragClaims.delete(event.gestureId);
      }
      return emptyDispatchResult();
    }

    const result = owner.handle(event, this.createContext());
    if (isDragEndEvent(event)) {
      this.dragClaims.delete(event.gestureId);
    }

    if (result.status === "ignored") {
      return {
        handledBy: [],
        consumedBy: null,
        claimedBy: ownerId,
      };
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

function emptyDispatchResult(): GestureActionRouterDispatchResult {
  return {
    handledBy: [],
    consumedBy: null,
    claimedBy: null,
  };
}
