import type { GridEdge, GridPoint, GridRotation } from "@/domain/types/grid";
import type {
  SimulationRuntimeStatus,
} from "@/domain/contract/simulation-contract-types";
import type {
  SimulationCurrentTickReadModel,
} from "@/domain/query/simulation-read-model";
import type {
  SimulationLinkType,
  SimulationRecipeType,
} from "@/domain/types/registry/simulation-definition";

export type {
  SimulationRuntimeStatus,
};

export interface SimulationCompileDiagnostic {
  readonly severity: "info" | "warning" | "error";
  readonly code: string;
  readonly message: string;
  readonly entityId?: string;
  readonly definitionId?: string;
}

export interface SimulationStartResult {
  readonly status: "started" | "failed";
  readonly topologyId: string | null;
  readonly diagnostics: readonly SimulationCompileDiagnostic[];
  readonly error?: string;
}

export type SimulationItemDomain = "solid" | "liquid";
export type SimulationPortKind = "item" | "fluid";
export type SimulationPortDirection = "input" | "output";
export type SimulationSlotType = "ingredient" | "product" | "universal";
export type SimulationNodeViewRole = "single-view" | "input-view" | "output-view";
export type SimulationCountLimit = number | "unlimited";
export type SimulationTransportClass = "strict-belt" | "strict-pipe" | "anchor" | "non-graph";
export type SimulationSubmitMode = "never" | "every-tick" | "every-n-seconds";
export type SimulationWorkerStatusMode = "idle" | "starting" | "running" | "stopped" | "error";
export type SimulationPlaybackState = "stop" | "start" | "pause";
export type SimulationState = SimulationPlaybackState;
export type SimulationCacheType = SimulationSlotType;

export interface SimulationAcceptRule {
  readonly base:
    | { readonly kind: "any" }
    | { readonly kind: "solid" }
    | { readonly kind: "liquid" }
    | { readonly kind: "item"; readonly itemId: string };
  readonly exclude: readonly string[];
}

export interface CompiledSimulationTopology {
  readonly schemaVersion: 2;
  readonly topologyId: string;
  readonly documentKey: string;
  readonly documentHash: string;
  readonly registryHash: string;
  readonly standardTickRate: number;
  readonly itemCatalog: Record<string, CompiledSimulationItem>;
  readonly devices: Record<string, CompiledSimulationDevice>;
  /** 对应《仿真运行原理》§6.0 / §6.1：Node 是编译后的求解图基本单元。 */
  readonly nodes: Record<string, CompiledSimulationNode>;
  /** 迁移期只供未改造消费侧读取；runtime 新实现不得以该字段作为主语义。 */
  readonly cacheGroups: Record<string, CompiledSimulationNode>;
  readonly slots: Record<string, CompiledSimulationSlot>;
  readonly ports: Record<string, CompiledSimulationPort>;
  readonly links: Record<string, CompiledSimulationSlotLink>;
  readonly physicalConnections: Record<string, CompiledSimulationPhysicalConnection>;
  readonly transferEdges: Record<string, CompiledSimulationTransferEdge>;
  readonly ordering: {
    readonly deviceOrder: readonly string[];
    readonly nodeOrder: readonly string[];
    /** 迁移期只供旧消费侧读取；等 renderer/app 消费面重构后删除。 */
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
  /** 对应《仿真运行原理》§8.1：求解顺序按设备视角组织，再处理设备内节点。 */
  readonly nodeIds: readonly string[];
  /** 迁移期只供旧消费侧读取；runtime 新实现使用 nodeIds。 */
  readonly cacheGroupIds: readonly string[];
  readonly portIds: readonly string[];
  readonly recipePlan: CompiledSimulationRecipePlan | null;
  readonly recipePlans: readonly CompiledSimulationRecipePlan[];
  readonly routing: Record<string, CompiledSimulationRoutingEntry>;
  readonly configHash: string;
}

export interface CompiledSimulationNode {
  readonly id: string;
  readonly deviceId: string;
  readonly sourceStorageSlotGroupId: string | null;
  /** 对应《仿真运行原理》§3.5：slot type 只表达配方存储角色，不决定端口方向。 */
  readonly cacheType: SimulationSlotType;
  /** 对应《仿真运行原理》§3.8：双向真实组必须展开为 input-view / output-view。 */
  readonly viewRole: SimulationNodeViewRole;
  readonly slotIds: readonly string[];
  readonly inputPortIds: readonly string[];
  readonly outputPortIds: readonly string[];
  readonly groupOrder: number;
}

export type CompiledSimulationCacheGroup = CompiledSimulationNode;

export interface CompiledSimulationSlot {
  readonly id: string;
  readonly cacheGroupId: string;
  readonly nodeId: string;
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

export type CompiledSimulationSlotTemplate = CompiledSimulationSlot;

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
  /** 对应《仿真运行原理》§6.2：port 绑定到编译后 Node，再由 port connection 生成边。 */
  readonly boundNodeIds: readonly string[];
  /** 迁移期只供旧 compiler 局部变量命名与旧消费侧读取。 */
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
  /** 对应《仿真运行原理》§6.2：边从 output-view Node 流向 input-view Node。 */
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  /** 迁移期只供旧字段消费；runtime 新实现使用 sourceNodeId / targetNodeId。 */
  readonly sourceCacheGroupId: string;
  readonly targetCacheGroupId: string;
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

export type CompiledSimulationCacheLink = CompiledSimulationSlotLink;

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

export interface SimulationTickReadResult {
  readonly status: SimulationTickPullStatus;
  readonly currentTick: SimulationCurrentTickReadModel | null;
}
