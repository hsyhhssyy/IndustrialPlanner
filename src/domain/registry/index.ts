export type { RegistryContract } from "./registry-contract";
export type { RegistryQuery } from "./registry-query";
export type {
	BaseDefinition,
	BaseOuterRingDefinition,
} from "./types/base-definition";
export type {
	EntityDefinition,
	UiGroup,
	ItemDomain,
	ItemFilterType,
	ItemFilterDefinition,
	PortGroupDefinition,
	PortDefinition,
	StorageSlotGroupDefinition,
	StorageSlotDefinition,
	PortStorageBindingDefinition,
	EntityAcceptRuleDefinition,
	EntityAdmissionRuleDefinition,
	// AI-REMOVED 2026-07-23:
	// Reason: domain 已删除固定窗口计量定义，公共出口不能继续导出不存在的类型。
	// Trigger: 用户逐项确认删除 EntityMeteredConsumptionDefinition。
	// Evidence: entity-definition.ts 已将原接口注释化归档。
	// Replacement: RecipeChannelDefinition.type + storageSlotGroups。
	// Risk: Medium
	// Human Review: Required
	//
	// Original code:
	// EntityMeteredConsumptionDefinition,
	// AI-REMOVED 2026-06-12:
	// Reason: 通用 port.count per-tick 限流已删除，domain API 不再导出 CountLimit。
	// Trigger: 用户确认 per tick count 不属于设计文档，应彻底删除。
	// Evidence: src/domain/registry/types/entity-definition.ts 已注释化删除 CountLimit。
	// Replacement: EntityAdmissionRuleDefinition。
	// Risk: Medium - 外部引用需迁移。
	// Human Review: Required
	//
	// Original code:
	// CountLimit,
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
export type { EntityVariantDefinition } from "./types/entity-variant-definition";
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
	ADMISSION_RATE_WINDOWS_PER_MINUTE,
} from "./types/logistics-constants";
export type { ItemDefinition } from "./types/item-definition";
export type { RecipeDefinition, RecipeType } from "./types/recipe-definition";
