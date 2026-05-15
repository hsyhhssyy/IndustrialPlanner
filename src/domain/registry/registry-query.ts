import type { LogisticsKind } from "../shared/logistics";
import type { SlotLinkDefinition } from "../shared/slot-link";

export interface RegistryQuery {
	isDedicatedLogisticsDevice(definitionId: string): boolean;
	resolveDedicatedLogisticsKind(definitionId: string): LogisticsKind | null;
	isGeneralLogisticsDevice(definitionId: string): boolean;

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
