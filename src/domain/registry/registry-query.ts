import type { LogisticsKind } from "../shared/logistics";
import type { SlotLinkDefinition } from "../shared/slot-link";
import type { ItemDomain } from "./types/entity-definition";

export interface RegistryQuery {
	isDedicatedLogisticsDevice(definitionId: string): boolean;
	resolveDedicatedLogisticsKind(definitionId: string): LogisticsKind | null;
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
	 * gas 标记优先于 liquid；未标记或不在注册表中的物品按 solid 处理。
	 */
	resolveItemDomain(itemId: string): ItemDomain;

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
