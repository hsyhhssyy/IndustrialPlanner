import type { LinkType } from "@/domain/entity/world-document";
import type { GridEdge, GridPoint, GridRotation } from "@/domain/types/grid";
import type { RecipeDefinition, RecipeType } from "@/domain/types/registry/recipe-definition";

export type SimulationItemDomain = "solid" | "liquid";
export type SimulationPortKind = "item" | "fluid";
export type SimulationPortDirection = "input" | "output";
export type SimulationSlotType = "ingredient" | "product" | "universal";
export type SimulationNodeViewRole = "single-view" | "input-view" | "output-view";
export type SimulationCountLimit = number | "unlimited";
export type SimulationTransportClass = "strict-belt" | "strict-pipe" | "anchor" | "non-graph";
export type SimulationSubmitMode = "never" | "every-tick" | "every-n-seconds";
export type SimulationWorkerStatusMode = "idle" | "starting" | "running" | "stopped" | "error";
export type SimulationRecipeType = RecipeType;
export type SimulationLinkType = LinkType;

export interface SimulationAcceptRule {
  readonly base:
    | { readonly kind: "any" }
    | { readonly kind: "solid" }
    | { readonly kind: "liquid" }
    | { readonly kind: "item"; readonly itemId: string };
  readonly exclude: readonly string[];
}

export interface SimulationCompileDiagnostic {
  readonly severity: "info" | "warning" | "error";
  readonly code: string;
  readonly message: string;
  readonly entityId?: string;
  readonly definitionId?: string;
}

export interface CompiledSimulationTopology {
  readonly schemaVersion: 3;
  readonly topologyId: string;
  readonly documentKey: string;
  readonly documentHash: string;
  readonly registryHash: string;
  readonly standardTickRate: number;
  readonly itemCatalog: Record<string, CompiledSimulationItem>;
  readonly recipeCatalog: Record<string, CompiledSimulationRecipeDefinition>;
  readonly devices: Record<string, CompiledSimulationDevice>;
  readonly nodes: Record<string, CompiledSimulationNode>;
  readonly slots: Record<string, CompiledSimulationSlot>;
  readonly ports: Record<string, CompiledSimulationPort>;
  readonly links: Record<string, CompiledSimulationSlotLink>;
  readonly physicalConnections: Record<string, CompiledSimulationPhysicalConnection>;
  readonly transferEdges: Record<string, CompiledSimulationTransferEdge>;
  readonly ordering: {
    readonly deviceOrder: readonly string[];
    readonly nodeOrder: readonly string[];
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

export interface CompiledSimulationRecipeDefinition {
  readonly id: string;
  readonly nameKey: string;
  readonly durationTicks: number;
  readonly inputs: readonly CompiledSimulationRecipeItem[];
  readonly outputs: readonly CompiledSimulationRecipeItem[];
  readonly machineId: string;
  readonly recipeType: SimulationRecipeType;
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
  readonly nodeIds: readonly string[];
  readonly ingredientNodeIds: readonly string[];
  readonly productNodeIds: readonly string[];
  readonly portIds: readonly string[];
  readonly routing: Record<string, CompiledSimulationRoutingEntry>;
  readonly configHash: string;
}

export interface CompiledSimulationNode {
  readonly id: string;
  readonly deviceId: string;
  readonly sourceStorageSlotGroupId: string | null;
  readonly slotType: SimulationSlotType;
  readonly viewRole: SimulationNodeViewRole;
  readonly slotIds: readonly string[];
  readonly inputPortIds: readonly string[];
  readonly outputPortIds: readonly string[];
  readonly groupOrder: number;
}

export interface CompiledSimulationSlot {
  readonly id: string;
  readonly nodeId: string;
  readonly sourceStorageSlotGroupId: string | null;
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
  readonly boundNodeIds: readonly string[];
  readonly acceptRule: SimulationAcceptRule;
  readonly count: SimulationCountLimit;
  readonly priorityGroup: number;
  readonly roundRobinSeed: number;
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
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly acceptRule: SimulationAcceptRule;
  readonly count: SimulationCountLimit;
}

export interface CompiledSimulationSlotLink {
  readonly id: string;
  readonly linkType: SimulationLinkType;
  readonly sourceSlotIds: readonly string[];
  readonly targetSlotIds: readonly string[];
  readonly targetSlotIdBySourceSlotId: Readonly<Record<string, string>>;
}

export interface CompiledSimulationRecipePlan {
  readonly recipeId: string;
  readonly recipeType: SimulationRecipeType;
  readonly durationTicks: number;
  readonly inputs: readonly CompiledSimulationRecipeItem[];
  readonly outputs: readonly CompiledSimulationRecipeItem[];
  readonly ingredientNodeIds: readonly string[];
  readonly productNodeIds: readonly string[];
}

export interface CompiledSimulationRecipeItem {
  readonly itemId: string | "any" | "same-as-input";
  readonly amount: number;
}

export interface CompiledSimulationRoutingEntry {
  readonly priorityGroup: number;
  readonly roundRobinSeed: number;
}

export type SimulationTickPullStatus =
  | {
      readonly status: "ready";
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

export interface SimulationTickSnapshotResult {
  readonly status: SimulationTickPullStatus;
  readonly currentTick: RuntimeTickSnapshot | null;
}

export interface RuntimeTickSnapshot {
  readonly topologyId: string;
  readonly documentHash: string;
  readonly tickNumber: number;
  readonly status: "initial" | "running";
  readonly slots: Record<string, RuntimeSlotSnapshot>;
  readonly devices: Record<string, RuntimeDeviceSnapshot>;
  readonly nodes: Record<string, RuntimeNodeSnapshot>;
  readonly transfers: readonly RuntimeTransferSnapshot[];
  readonly routingCursors: Record<string, number>;
  readonly diagnostics: readonly RuntimeDiagnosticSnapshot[];
}

export interface RuntimeSlotSnapshot {
  readonly slotId: string;
  readonly itemType: string | null;
  readonly count: number;
  readonly reserved: number;
}

export interface RuntimeDeviceSnapshot {
  readonly deviceId: string;
  readonly block: boolean;
  readonly recipe: RuntimeDeviceRecipeSnapshot | null;
}

export interface RuntimeDeviceRecipeSnapshot {
  readonly runId: string;
  readonly recipeId: string;
  readonly recipeType: SimulationRecipeType;
  readonly progressTicks: number;
  readonly durationTicks: number;
  readonly state: "running" | "waiting-output";
}

export interface RuntimeNodeSnapshot {
  readonly nodeId: string;
  readonly result: "uncertain" | "solved-run" | "solved-block";
  readonly acceptedInputEdgeIds: readonly string[];
  readonly acceptedOutputEdgeIds: readonly string[];
  readonly blockReason?: string;
}

export interface RuntimeTransferSnapshot {
  readonly edgeId: string;
  readonly sourceSlotId: string;
  readonly targetSlotId: string;
  readonly itemType: string;
  readonly amount: number;
}

export interface RuntimeDiagnosticSnapshot {
  readonly severity: "info" | "warning" | "error";
  readonly code: string;
  readonly message: string;
}

export function compileRecipeDefinition(
  recipe: RecipeDefinition,
  durationTicks: number,
): CompiledSimulationRecipeDefinition {
  return {
    id: recipe.id,
    nameKey: recipe.nameKey,
    durationTicks,
    inputs: recipe.inputs.map((input) => ({ ...input })),
    outputs: recipe.outputs.map((output) => ({ ...output })),
    machineId: recipe.machineId,
    recipeType: recipe.recipeType,
    tags: [...recipe.tags].sort(),
  };
}
