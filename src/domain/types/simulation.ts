import type {
  GridEdge,
  GridPoint,
  GridRotation,
} from "./grid";

export type SimulationItemDomain = "solid" | "liquid";
export type SimulationPortKind = "item" | "fluid";
export type SimulationPortDirection = "input" | "output";
export type SimulationCacheType = "ingredient" | "product" | "universal";
export type SimulationLinkType = "share-cap" | "share-all";
export type SimulationCountLimit = number | "unlimited";

export type SimulationTransportClass =
  | "strict-belt"
  | "strict-pipe"
  | "anchor"
  | "non-graph";

export type SimulationRecipeType =
  | "immediate-consume"
  | "reserved-item";

export type SimulationSubmitMode =
  | "never"
  | "every-tick"
  | "every-n-seconds";

export type SimulationWorkerStatusMode =
  | "idle"
  | "starting"
  | "running"
  | "stopped"
  | "error";

export interface SimulationAcceptRule {
  readonly base:
    | { readonly kind: "any" }
    | { readonly kind: "solid" }
    | { readonly kind: "liquid" }
    | { readonly kind: "item"; readonly itemId: string };
  readonly exclude: readonly string[];
}

export interface CompiledSimulationTopology {
  readonly schemaVersion: 1;
  readonly topologyId: string;
  readonly documentKey: string;
  readonly documentHash: string;
  readonly registryHash: string;
  readonly tickRate: {
    readonly ticksPerSecond: number;
  };
  readonly itemCatalog: Record<string, CompiledSimulationItem>;
  readonly devices: Record<string, CompiledSimulationDevice>;
  readonly cacheGroups: Record<string, CompiledSimulationCacheGroup>;
  readonly slots: Record<string, CompiledSimulationSlotTemplate>;
  readonly ports: Record<string, CompiledSimulationPort>;
  readonly links: Record<string, CompiledSimulationCacheLink>;
  readonly physicalConnections: Record<string, CompiledSimulationPhysicalConnection>;
  readonly transferEdges: Record<string, CompiledSimulationTransferEdge>;
  readonly ordering: {
    readonly deviceOrder: readonly string[];
    readonly cacheGroupOrder: readonly string[];
    readonly slotOrder: readonly string[];
    readonly portOrder: readonly string[];
    readonly physicalConnectionOrder: readonly string[];
    readonly edgeOrder: readonly string[];
  };
  readonly diagnostics: readonly SimulationCompileDiagnostic[];
}

export interface CompiledSimulationItem {
  readonly id: string;
  readonly domain: SimulationItemDomain;
  readonly tags: readonly string[];
}

export interface CompiledSimulationDevice {
  readonly id: string;
  readonly sourceEntityId: string | null;
  readonly definitionId: string;
  readonly position: GridPoint | null;
  readonly rotation: GridRotation | null;
  readonly tags: readonly string[];
  readonly transportClass: SimulationTransportClass;
  readonly cacheGroupIds: readonly string[];
  readonly portIds: readonly string[];
  readonly recipePlan: CompiledSimulationRecipePlan | null;
  readonly routing: Record<string, CompiledSimulationRoutingEntry>;
  readonly configHash: string;
}

export interface CompiledSimulationCacheGroup {
  readonly id: string;
  readonly deviceId: string;
  readonly sourceStorageSlotGroupId: string | null;
  readonly cacheType: SimulationCacheType;
  readonly slotIds: readonly string[];
  readonly inputPortIds: readonly string[];
  readonly outputPortIds: readonly string[];
  readonly groupOrder: number;
}

export interface CompiledSimulationSlotTemplate {
  readonly id: string;
  readonly cacheGroupId: string;
  readonly sourceSlotId: string | null;
  readonly capacity: number;
  readonly domain: SimulationItemDomain | "any";
  readonly lock: string | null;
  readonly initialItemType: string | null;
  readonly initialCount: number;
  readonly ignoreStock: boolean;
  readonly submitMode: SimulationSubmitMode;
  readonly submitIntervalTicks: number | null;
}

export interface CompiledSimulationPort {
  readonly id: string;
  readonly deviceId: string;
  readonly portGroupId: string;
  readonly portDefinitionId: string;
  readonly kind: SimulationPortKind;
  readonly direction: SimulationPortDirection;
  readonly insideGridPoint: GridPoint;
  readonly outsideGridPoint: GridPoint;
  readonly edge: GridEdge;
  readonly boundCacheGroupIds: readonly string[];
  readonly acceptRule: SimulationAcceptRule;
  readonly count: SimulationCountLimit;
  readonly order: number;
}

export interface CompiledSimulationPhysicalConnection {
  readonly id: string;
  readonly sourcePortId: string;
  readonly targetPortId: string;
  readonly sourceInsideGridPoint: GridPoint;
  readonly targetInsideGridPoint: GridPoint;
}

export interface CompiledSimulationTransferEdge {
  readonly id: string;
  readonly physicalConnectionId: string;
  readonly sourcePortId: string;
  readonly targetPortId: string;
  readonly sourceCacheGroupId: string;
  readonly targetCacheGroupId: string;
  readonly acceptRule: SimulationAcceptRule;
  readonly count: SimulationCountLimit;
}

export interface CompiledSimulationCacheLink {
  readonly id: string;
  readonly linkType: SimulationLinkType;
  readonly endpointSlotIds: readonly string[];
  readonly shareLimit: number | null;
}

export interface CompiledSimulationRecipePlan {
  readonly recipeId: string;
  readonly recipeType: SimulationRecipeType;
  readonly durationTicks: number;
  readonly inputs: readonly CompiledSimulationRecipeItem[];
  readonly outputs: readonly CompiledSimulationRecipeItem[];
  readonly ingredientCacheGroupIds: readonly string[];
  readonly productCacheGroupIds: readonly string[];
}

export interface CompiledSimulationRecipeItem {
  readonly itemId: string | "any" | "same-as-input";
  readonly amount: number;
}

export interface CompiledSimulationRoutingEntry {
  readonly priorityGroup: number;
  readonly roundRobinSeed: number;
}

export interface SimulationCompileDiagnostic {
  readonly severity: "info" | "warning" | "error";
  readonly code: string;
  readonly message: string;
  readonly entityId?: string;
  readonly definitionId?: string;
}

export interface SimulationRuntimeStatus {
  readonly mode: SimulationWorkerStatusMode;
  readonly topologyId: string | null;
  readonly documentHash: string | null;
  readonly retainedFromTick: number | null;
  readonly latestTickNumber: number | null;
  readonly bufferSize: number;
  readonly maxBufferSize: number;
  readonly error: string | null;
}

export interface SimulationStartResult {
  readonly status: "started" | "failed";
  readonly topologyId: string | null;
  readonly diagnostics: readonly SimulationCompileDiagnostic[];
  readonly error?: string;
}

export type GetSimulationTickSnapshotResult =
  | {
      readonly status: "ready";
      readonly snapshot: SimulationTickSnapshot;
      readonly retainedFromTick: number;
      readonly latestTickNumber: number;
      readonly bufferSize: number;
    }
  | {
      readonly status: "not-ready";
      readonly requestedTickNumber: number;
      readonly retainedFromTick: number | null;
      readonly latestTickNumber: number | null;
      readonly bufferSize: number;
    }
  | {
      readonly status: "not-found";
      readonly reason: "cleared" | "missing-topology" | "unknown";
      readonly requestedTickNumber: number;
      readonly retainedFromTick: number | null;
      readonly latestTickNumber: number | null;
      readonly bufferSize: number;
    };

export interface SimulationTickSnapshot {
  readonly schemaVersion: 1;
  readonly topologyId: string;
  readonly documentHash: string;
  readonly tickNumber: number;
  readonly status: "initial" | "running" | "paused" | "stopped";
  readonly slots: Record<string, SimulationSlotRuntimeSnapshot>;
  readonly devices: Record<string, SimulationDeviceRuntimeSnapshot>;
  readonly nodes: Record<string, SimulationNodeSolveSnapshot>;
  readonly transfers: readonly SimulationTickTransferSnapshot[];
  readonly routingCursors: Record<string, number>;
  readonly warehouse: Record<string, number>;
  readonly diagnostics: readonly SimulationTickDiagnostic[];
}

export interface SimulationSlotRuntimeSnapshot {
  readonly slotId: string;
  readonly itemType: string | null;
  readonly count: number;
  readonly reserved: readonly SimulationReservedItemSnapshot[];
}

export interface SimulationReservedItemSnapshot {
  readonly recipeRunId: string;
  readonly itemType: string;
  readonly amount: number;
}

export interface SimulationDeviceRuntimeSnapshot {
  readonly deviceId: string;
  readonly block: boolean;
  readonly recipe: SimulationDeviceRecipeRuntimeSnapshot | null;
}

export interface SimulationDeviceRecipeRuntimeSnapshot {
  readonly runId: string;
  readonly recipeId: string;
  readonly recipeType: SimulationRecipeType;
  readonly progressTicks: number;
  readonly durationTicks: number;
  readonly state: "running" | "waiting-output" | "idle";
}

export interface SimulationNodeSolveSnapshot {
  readonly cacheGroupId: string;
  readonly result: "uncertain" | "solved-run" | "solved-block";
  readonly acceptedInputEdgeIds: readonly string[];
  readonly acceptedOutputEdgeIds: readonly string[];
  readonly blockReason?: string;
}

export interface SimulationTickTransferSnapshot {
  readonly edgeId: string;
  readonly sourceSlotId: string;
  readonly targetSlotId: string;
  readonly itemType: string;
  readonly amount: number;
}

export interface SimulationTickDiagnostic {
  readonly severity: "info" | "warning" | "error";
  readonly code: string;
  readonly message: string;
}
