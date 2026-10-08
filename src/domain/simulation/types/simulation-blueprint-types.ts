import type { BlueprintDocument } from "../../document/blueprint-document";
import type { WorldEntity, SlotLinkDefinition, WorldDocumentSettings } from "../../document/world-document";
import type { SimulationRuntimeSlotPatch, SimulationDeviceOperatingStatus, SimulationEngineKind } from "./simulation-types";

export interface SimulationBlueprintScene {
  readonly externalEntities: readonly WorldEntity[];
  readonly externalSlotLinks: readonly SlotLinkDefinition[];
  readonly initialSlots: readonly SimulationRuntimeSlotPatch[];
  /** 在指定仿真时刻补料一次；仅作用于独立执行场景，不写入交付蓝图。 */
  readonly scheduledSlots?: readonly {
    readonly simulationSeconds: number;
    readonly patch: SimulationRuntimeSlotPatch;
  }[];
  readonly powerMode: WorldDocumentSettings["powerMode"];
}

export interface SimulationBlueprintProbe {
  readonly id: string;
  readonly entityIds: readonly string[];
  readonly itemId: string;
  readonly direction: "input" | "output";
}

export interface SimulationBlueprintRunRequest {
  /** 独立执行可固定 Dense 时钟，不随工作台当前引擎或加速设置改变。 */
  readonly engine?: { readonly kind: "dense-v2"; readonly ticksPerSecond: 2 | 4 };
  /** 按真实通道累计识别信息；省略时不采集，不影响普通仿真成本。 */
  readonly collectAnalysis?: boolean;
  readonly blueprint: BlueprintDocument;
  readonly scene: SimulationBlueprintScene;
  readonly probes: readonly SimulationBlueprintProbe[];
  readonly warmupSeconds: number;
  readonly observationSeconds: number;
  readonly inventorySampleCount: number;
  readonly maxWallTimeMs: number;
  readonly activeActivityIds: readonly string[];
}

export interface SimulationBlueprintDiagnostic {
  readonly severity: "info" | "warning" | "error";
  readonly code: string;
  readonly message: string;
  readonly entityId?: string;
}

export interface SimulationBlueprintProbeResult {
  readonly id: string;
  readonly amount: number;
  readonly perMinute: number;
}

export interface SimulationBlueprintInventorySample {
  readonly simulationSeconds: number;
  readonly itemAmounts: Readonly<Record<string, number>>;
}

export interface SimulationBlueprintDeviceStatus {
  readonly entityId: string;
  readonly status: SimulationDeviceOperatingStatus;
}

export interface SimulationBlueprintRunReport {
  readonly analysis?: SimulationBlueprintAnalysis;
  readonly status: "completed" | "cancelled" | "timeout" | "failed";
  readonly engineKind: SimulationEngineKind;
  readonly simulationSeconds: number;
  readonly observationSeconds: number;
  readonly elapsedMs: number;
  readonly probes: readonly SimulationBlueprintProbeResult[];
  readonly inventorySamples: readonly SimulationBlueprintInventorySample[];
  readonly deviceStatuses: readonly SimulationBlueprintDeviceStatus[];
  readonly diagnostics: readonly SimulationBlueprintDiagnostic[];
}

/** 编译后的物理端口与库存绑定；不暴露仿真内部可变对象。 */
export interface SimulationBlueprintAnalysisPort {
  readonly id: string;
  readonly entityId: string;
  readonly groupId: string;
  readonly portId: string;
  readonly direction: "input" | "output";
  readonly isPipe: boolean;
  readonly nodeIds: readonly string[];
  readonly acceptedItemIds: readonly string[];
  readonly admissionItemId: string | null;
}

export interface SimulationBlueprintAnalysis {
  readonly ports: readonly SimulationBlueprintAnalysisPort[];
  readonly connections: readonly { sourcePortId: string; targetPortId: string }[];
  readonly channels: readonly { entityId: string; channelId: string; consumption: boolean;
    inputNodeIds: readonly string[]; outputNodeIds: readonly string[];
    configuredRecipeId: string | null; manual: boolean; observedRecipeIds: readonly string[] }[];
  /** 正式观察期同一真实 tick 的全部通道配方；忽略通道顺序，保留重复数量与空组合。 */
  readonly recipeCombinations: readonly { entityId: string; recipeIds: readonly string[];
    windowSampleCounts: readonly number[] }[];
  readonly slots: readonly { entityId: string; nodeId: string; groupId: string | null; slotId: string | null;
    itemId: string | null; count: number; infinite: boolean }[];
  /** 全程物品集合包含预热；四段流量只累计观察期，不保存逐 tick 历史。 */
  readonly transfers: readonly { sourcePortId: string; targetPortId: string; itemId: string;
    totalAmount: number; windowAmounts: readonly number[] }[];
}
