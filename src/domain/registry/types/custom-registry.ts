import type { RegistryContract } from "../registry-contract";
import type { EntityDefinition } from "./entity-definition";
import type { EntityRangeDefinition } from "./entity-range";
import type { PeriodicRangeConversionProgram } from "./periodic-range-conversion";
import type { RecipeDefinition } from "./recipe-definition";

export interface CustomRegistryLibrary {
  readonly formatVersion: 1;
  readonly entities: readonly CustomEntityDefinitionInput[];
  readonly items: readonly CustomItemDefinitionInput[];
  readonly recipes: readonly CustomRecipeDefinitionInput[];
  readonly periodicRangeConversionPrograms?: readonly PeriodicRangeConversionProgram[];
  readonly entityMigrations?: Readonly<Record<string, string>>;
}

export interface CustomEntityDefinitionInput {
  readonly uuid: string;
  readonly name: string;
  readonly overrideDefinitionId?: string;
  readonly footprint: EntityDefinition["footprint"];
  readonly powerDemand: number;
  readonly portGroups: EntityDefinition["portGroups"];
  readonly storageSlotGroups: EntityDefinition["storageSlotGroups"];
  readonly recipeChannels: EntityDefinition["recipeChannels"];
  readonly portStorageBindings: EntityDefinition["portStorageBindings"];
  readonly ranges: readonly EntityRangeDefinition[];
  readonly allowDuplicateRecipesAcrossChannels: boolean;
  readonly consumption?: CustomDeviceConsumptionInput;
  readonly periodicRangeConversion?: {
    readonly programId: string;
    readonly rangeIds: readonly string[];
    readonly phases: readonly { readonly uuid: string; readonly name: string; readonly side: 0 | 1 }[];
  };
}

export interface CustomDeviceConsumptionInput {
  readonly itemIds: readonly string[];
  readonly portGroupIds: readonly string[];
}

export interface CustomItemDefinitionInput {
  readonly uuid: string;
  readonly name: string;
  readonly phase: "solid" | "liquid" | "gas";
}

export interface CustomRecipeDefinitionInput {
  readonly uuid: string;
  readonly name: string;
  readonly machineId: string;
  readonly durationSeconds?: number;
  readonly inputs: RecipeDefinition["inputs"];
  readonly outputs: RecipeDefinition["outputs"];
  readonly recipeType?: RecipeDefinition["recipeType"];
  readonly behavior?: RecipeDefinition["behavior"];
  readonly probability?: number;
  readonly requiredEnvironmentAnyOf?: readonly string[];
  readonly environmentOutput?: RecipeDefinition["environmentOutput"];
}

export interface CustomRegistryMetadata {
  readonly customEntityUuids: Readonly<Record<string, string>>;
  readonly overrideEntityUuids: Readonly<Record<string, string>>;
  readonly itemUuids: Readonly<Record<string, string>>;
  readonly recipeUuids: Readonly<Record<string, string>>;
  readonly names: Readonly<Record<string, string>>;
}

export interface CustomRegistryValidationIssue {
  readonly path: string;
  readonly message: string;
}

export type RegistrySnapshot = Pick<
  RegistryContract,
  "baseDefinitions" | "entityDefinitions" | "entityVariantDefinitions" | "itemDefinitions" | "recipeDefinitions" | "formationDefinitions" | "customContent"
>;

// AI-REMOVED 2026-11-26:
// Reason: ST3-RQ-002 物料关系、分层概率和投影范围分别由配方行为及本地口声明。
// Trigger: 阵列四层必成、双口独立和跨读者单一配方来源的已确认需求。
// Evidence: 此文件的原有声明或消费者引用已迁入下述实现，回归清单见 ST3-RQ-002 执行日志。
// Replacement: registry/recipe-definition.ts、registry/entity-definition.ts 与 shared/formation-recipes.ts
// Risk: 恢复历史逻辑会同时启用两条业务路径。
// Human Review: Required
//
// Original code:
//   readonly durationSeconds: number;
//
//   readonly recipeType: RecipeDefinition["recipeType"];
//
//   "baseDefinitions" | "entityDefinitions" | "entityVariantDefinitions" | "itemDefinitions" | "recipeDefinitions" | "customContent"
