import type {
  ModuleBalancingCustomModule,
  ModuleBalancingRecommendedModule,
} from "@/app/toolbox-types";

export type ProductionPlanningCandidateSourceType =
  | "system-recipe"
  | "custom-module"
  | "recommended-module";

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
  readonly iconId: string;
  readonly notes: string;
  readonly inputs: readonly ProductionPlanningCandidatePort[];
  readonly outputs: readonly ProductionPlanningCandidatePort[];
}

export interface ProductionPlanningCandidate {
  readonly id: string;
  readonly sourceType: ProductionPlanningCandidateSourceType;
  readonly inputs: readonly ProductionPlanningCandidatePort[];
  readonly outputs: readonly ProductionPlanningCandidatePort[];
  readonly order: number;
  readonly recipeId: string | null;
  readonly module: ProductionPlanningModuleSnapshot | null;
}

export type ProductionPlanningModuleDefinition =
  | ModuleBalancingCustomModule
  | ModuleBalancingRecommendedModule;

export function createProductionPlanningRecipeCandidateId(recipeId: string): string {
  return `recipe:${recipeId}`;
}

export function createProductionPlanningModuleCandidateId(
  sourceType: "custom" | "recommended",
  moduleId: string,
): string {
  return `module:${sourceType}:${moduleId}`;
}

export function normalizeProductionPlanningCandidateChoiceId(candidateId: string): string {
  if (candidateId.startsWith("recipe:") || candidateId.startsWith("module:")) {
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
    iconId: module.iconId,
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
