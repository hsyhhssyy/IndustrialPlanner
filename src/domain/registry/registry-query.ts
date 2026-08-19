import type {
	LogisticsKind,
	LogisticsPathShape,
	LogisticsRole,
} from "../shared/logistics";
import type { SlotLinkDefinition } from "../shared/slot-link";
import type { ItemDomain } from "./types/entity-definition";
import type { EntityDefinition } from "./types/entity-definition";
import type { ItemDefinition } from "./types/item-definition";
import type { RecipeDefinition } from "./types/recipe-definition";
// AI-REMOVED 2026-08-19:
// Reason: RegistryQuery 不再解析按 SimulationMode 声明的设备覆盖配置。
// Trigger: 用户要求删除 simulationModeConfigs 及对应基础设施。
// Evidence: Registry 设备行为与 Inspector 现在只有基础声明。
// Replacement: findEntityDefinition 返回 EntityDefinition.simulationBehaviors 与 inspectors。
// Risk: Medium - 调用方必须直接读取基础声明。
// Human Review: Required
//
// Original code:
// import type { EntitySimulationModeConfig } from "./types/entity-simulation-mode";
// import type { SimulationMode } from "../shared/simulation-mode";

export interface RegistryQuery {
	/** 按 ID 精确查找实体定义；未注册时返回 null。 */
	findEntityDefinition(definitionId: string): EntityDefinition | null;
	/** 按 ID 精确查找物品定义；未注册时返回 null。 */
	findItemDefinition(itemId: string): ItemDefinition | null;
	/** 按 ID 精确查找配方定义；未注册时返回 null。 */
	findRecipeDefinition(recipeId: string): RecipeDefinition | null;
	/** 返回指定设备的全部已注册配方；结果顺序与 registry 定义顺序一致。 */
	findRecipeDefinitionsByMachine(machineId: string): readonly RecipeDefinition[];
	// AI-REMOVED 2026-08-19:
	// Reason: RegistryQuery 不再提供设备模式覆盖解析入口。
	// Trigger: 用户要求 Registry 不再设计 mode 开关。
	// Evidence: EntityDefinition.simulationModeConfigs 已退出 Active Code。
	// Replacement: findEntityDefinition。
	// Risk: Medium - App 与 Topology Compiler 调用点必须同步删除。
	// Human Review: Required
	//
	// Original code:
	// /** 解析设备在指定仿真模式下声明的静态配置；未声明时返回 null。 */
	// resolveEntitySimulationModeConfig(
	// 	definitionId: string,
	// 	simulationMode: SimulationMode,
	// ): EntitySimulationModeConfig | null;

	/** 判定是否为传送带节：仅包括直线节和两个转角节。 */
	isBelt(definitionId: string): boolean;
	/** 判定是否为传送带物流设备；传送带物流设备不包括传送带节。 */
	isBeltLogistics(definitionId: string): boolean;
	/** 判定是否属于传送带族：传送带节与传送带物流设备的并集。 */
	isBeltFamily(definitionId: string): boolean;

	/** 判定是否为管道节：仅包括直线节和两个转角节。 */
	isPipe(definitionId: string): boolean;
	/** 判定是否为管道物流设备；管道物流设备不包括管道节。 */
	isPipeLogistics(definitionId: string): boolean;
	/** 判定是否属于管道设备族：管道节与管道物流设备的并集。 */
	isPipeFamily(definitionId: string): boolean;

	/** 按物流族和路径形状解析传送带节或管道节的 definition ID。 */
	resolveLogisticsDefinitionId(
		kind: LogisticsKind,
		shape: LogisticsPathShape,
	): string;

	/**
	 * 解析分流器、汇流器、桥接器或准入口的通用物流角色。
	 * 传送带节、管道节和非物流设备均返回 null。
	 */
	resolveLogisticsRole(definitionId: string): LogisticsRole | null;

	/** @deprecated 兼容旧调用；现行语义为“是否为传送带节或管道节”，请改用 isBelt / isPipe。 */
	isDedicatedLogisticsDevice(definitionId: string): boolean;
	/** @deprecated 兼容旧调用；解析传送带节或管道节类型，请优先组合 isBelt / isPipe。 */
	resolveDedicatedLogisticsKind(definitionId: string): LogisticsKind | null;
	/**
	 * @deprecated 兼容旧调用；现行语义为“是否属于传送带族或管道设备族”。
	 * 请改用 isBeltFamily / isPipeFamily。传送带物流设备不包括传送带节，
	 * 管道物流设备不包括管道节。
	 */
	isGeneralLogisticsDevice(definitionId: string): boolean;

	/**
	 * 判定 definitionId 是否为协议核心设备。
	 * 协议核心不可删除，基地初始化时自动创建，蓝图放置含协议核心时移动而非新增。
	 */
	isProtocolCore(definitionId: string): boolean;

	/**
	 * 判定物品是否为液体域。
	 * 依据 item-definition.ts 中的 tags: ["liquid", ...] 标记。
	 * 未标记或不在注册表中的物品一律返回 false（固体）。
	 */
	isItemLiquid(itemId: string): boolean;

	/**
	 * 解析物品域。
	 * gas 标记优先于 liquid；已注册但未标记的物品按 solid 处理，未注册物品返回 null。
	 */
	resolveItemDomain(itemId: string): ItemDomain | null;

	/**
	 * 构建"实体槽位 → 仓库槽位"的 Slot Link 定义。
	 *
	 * source.entityId 由调用方填入实体 ID。
	 * target.entityId 固定为 "warehouse"（编译器运行时根据文档 baseId 解析为 device:warehouse:{baseId}）。
	 * 蓝图 config 可跨世界复用，不绑定特定 baseId。
	 *
	 * @param options.entityId — 当前设备实体 ID
	 * @param options.storageSlotGroupId — 存储槽组 ID
	 * @param options.slotId — 槽位 ID
	 * @param options.itemId — 物品 ID
	 */
	buildWarehouseSlotLinkForEntity(options: {
		entityId: string;
		storageSlotGroupId: string;
		slotId: string;
		itemId: string;
	}): SlotLinkDefinition;
}
