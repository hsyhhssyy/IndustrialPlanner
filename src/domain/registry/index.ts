export type { RegistryContract } from "./registry-contract";
export type { RegistryQuery } from "./registry-query";
export type {
	BaseDefinition,
	BaseOuterRingDefinition,
} from "./types/base-definition";
export type {
	EntityDefinition,
	UiGroup,
	ItemFilterDefinition,
	PortGroupDefinition,
	PortDefinition,
	StorageSlotGroupDefinition,
	StorageSlotDefinition,
	PortStorageBindingDefinition,
	EntityAcceptRuleDefinition,
	CountLimit,
	// AI-REMOVED 2026-06-06:
	// Reason: SubmitMode 类型已从 StorageSlotDefinition 删除，domain API 不再导出旧机制。
	// Trigger: 用户要求 submit mode 机制彻底删除。
	// Evidence: src/domain/registry/types/entity-definition.ts 已注释化删除 SubmitMode。
	// Replacement: WarehouseSink tag / r_warehouse_submit recipe.
	// Risk: Medium - 外部引用需迁移。
	// Human Review: Required
	//
	// Original code:
	// SubmitMode,
	StorageGroupSplitLinkType,
} from "./types/entity-definition";
export type {
	EntityInspectorDeclaration,
	EntityInspectorType,
} from "./types/entity-inspector";
export { INSPECTOR_TYPE } from "./types/entity-inspector";
export { PLACEMENT_BEHAVIOR_TYPE } from "./types/entity-placement-behavior";
export type {
	EntityPlacementBehaviorDeclaration,
	PlacementBehaviorType,
} from "./types/entity-placement-behavior";
export {
	BELT_TRANSPORT_DURATION_SECONDS,
	PIPE_TRANSPORT_DURATION_SECONDS,
} from "./types/logistics-constants";
export type { ItemDefinition } from "./types/item-definition";
export type { RecipeDefinition, RecipeType } from "./types/recipe-definition";
