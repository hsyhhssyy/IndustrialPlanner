import type {
  ModuleBalancingCustomModule,
  ModuleBalancingRecommendedModule,
} from "@/app/toolbox-types";

export type ProductionPlanningCandidateSourceType =
  | "system-recipe"
  | "custom-module"
  | "recommended-module"
  | "environment-range";

export interface ProductionPlanningCandidatePort {
  readonly itemId: string;
  /** 一个候选单位满速运行时的每分钟流量。 */
  readonly perMinute: number;
}

export interface ProductionPlanningModuleSnapshot {
  readonly id: string;
  readonly sourceType: "custom-module" | "recommended-module";
  readonly name: string;
  readonly color: string;
  readonly iconItemIds: readonly string[];
  readonly notes: string;
  readonly inputs: readonly ProductionPlanningCandidatePort[];
  readonly outputs: readonly ProductionPlanningCandidatePort[];
}

export interface ProductionPlanningProbabilityBranch {
  readonly recipeId: string;
  /** 同一原料组内的执行份额，组内合计为 1。 */
  readonly share: number;
}

/** 同设备、同原料、同时长的互斥概率分支；产出按份额折算为期望值。 */
export interface ProductionPlanningProbabilityGroup {
  readonly machineId: string;
  readonly durationSeconds: number;
  readonly branches: readonly ProductionPlanningProbabilityBranch[];
  /** 组内按默认优先级排序的首条配方，用于设备、运行耗材与导出。 */
  readonly representativeRecipeId: string;
}

export interface ProductionPlanningEnvironmentRange {
  /** 区域附属设备；占位节点显示它。 */
  readonly deviceId: string;
  /** 实际提供该区域的炉子。 */
  readonly ownerDeviceIds: readonly string[];
  readonly effectIndex: number;
  readonly periodSeconds: number;
}

export interface ProductionPlanningCandidate {
  readonly id: string;
  readonly sourceType: ProductionPlanningCandidateSourceType;
  readonly inputs: readonly ProductionPlanningCandidatePort[];
  readonly outputs: readonly ProductionPlanningCandidatePort[];
  readonly order: number;
  readonly recipeId: string | null;
  readonly module: ProductionPlanningModuleSnapshot | null;
  /** 系统配方与概率组使用真实周期；模块候选为 60 秒。 */
  readonly durationSeconds: number;
  readonly probabilityGroup: ProductionPlanningProbabilityGroup | null;
  /** 区域环境转化占位；固定 1 台、不计运行消耗。 */
  readonly environmentRange: ProductionPlanningEnvironmentRange | null;
}

export type ProductionPlanningModuleDefinition =
  | ModuleBalancingCustomModule
  | ModuleBalancingRecommendedModule;

export function createProductionPlanningRecipeCandidateId(recipeId: string): string {
  return `recipe:${recipeId}`;
}

export function createProductionPlanningProbabilityCandidateId(representativeRecipeId: string): string {
  return `probability:${representativeRecipeId}`;
}

export function createProductionPlanningEnvironmentRangeCandidateId(
  deviceId: string,
  effectIndex: number,
  inputItemId: string,
): string {
  return `environment-range:${deviceId}:${effectIndex}:${inputItemId}`;
}

export function createProductionPlanningModuleCandidateId(
  sourceType: "custom" | "recommended",
  moduleId: string,
): string {
  return `module:${sourceType}:${moduleId}`;
}

export function normalizeProductionPlanningCandidateChoiceId(candidateId: string): string {
  if (
    candidateId.startsWith("recipe:")
    || candidateId.startsWith("module:")
    || candidateId.startsWith("probability:")
    || candidateId.startsWith("environment-range:")
  ) {
    return candidateId;
  }

  return createProductionPlanningRecipeCandidateId(candidateId);
}

export function createProductionPlanningModuleSnapshot(
  module: ProductionPlanningModuleDefinition,
): ProductionPlanningModuleSnapshot {
  return {
    id: module.id,
    sourceType: module.sourceType === "custom" ? "custom-module" : "recommended-module",
    name: module.name,
    color: module.color,
    iconItemIds: [...module.iconItemIds],
    notes: module.notes,
    inputs: module.inputs.map(cloneCandidatePort),
    outputs: module.outputs.map(cloneCandidatePort),
  };
}

function cloneCandidatePort(port: ProductionPlanningCandidatePort): ProductionPlanningCandidatePort {
  return {
    itemId: port.itemId,
    perMinute: port.perMinute,
  };
}
