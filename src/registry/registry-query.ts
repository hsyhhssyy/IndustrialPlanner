import type { RegistryQuery } from "@/domain/registry/registry-query"
import type { LogisticsKind } from "@/domain/shared/logistics"
import type { ItemDomain } from "@/domain/registry/types/entity-definition"
import { ITEM_DEFINITIONS } from "./item-definition"

const ITEM_DOMAIN_BY_ID = new Map<string, ItemDomain>(
    ITEM_DEFINITIONS.map((item) => [
        item.id,
        item.tags.includes("gas")
            ? "gas"
            : item.tags.includes("liquid")
                ? "liquid"
                : "solid",
    ]),
)

/**
 * 专用物流设备 → 运输类别映射。
 *
 * 仅最基本的传送带/管道直段和转弯段在此注册，对应 strict-belt / strict-pipe。
 *
 * 以下通用物流设备**有意不在此注册**，resolveDedicatedLogisticsKind 对它们返回 null，
 * 使其归为 anchor 运输类别：
 *   - item_pipe_splitter / item_pipe_converger / item_pipe_connector / item_pipe_admission
 *   - item_log_splitter / item_log_converger / item_log_connector / item_log_admission
 * AI-CORRECTION 2026-07-19: 当前上述设备定义 ID 已移除 item_ 前缀；原名仅作历史审计。
 *
 * 原因：这些设备有自己的 buffer 和独立搬运配方，不应受管道/传送带域锁约束，
 * 且应分割 TransportComponent 连通分量。这是仿真设计的明确规定。
 */
const DEDICATED_LOGISTICS_DEVICE_KINDS = new Map<string, LogisticsKind>([
    ["belt_straight_1x1", "belt"],
    ["belt_turn_cw_1x1", "belt"],
    ["belt_turn_ccw_1x1", "belt"],
    ["pipe_straight_1x1", "pipe"],
    ["pipe_turn_cw_1x1", "pipe"],
    ["pipe_turn_ccw_1x1", "pipe"],
])

const DEDICATED_LOGISTICS_DEVICE_IDS = new Set<string>(
    DEDICATED_LOGISTICS_DEVICE_KINDS.keys(),
)

const GENERAL_LOGISTICS_DEVICE_IDS = new Set<string>([
    ...DEDICATED_LOGISTICS_DEVICE_IDS,
    "log_splitter",
    "log_converger",
    "log_connector",
    "log_admission",
    "pipe_splitter",
    "pipe_converger",
    "pipe_connector",
    "pipe_admission",
])

const PROTOCOL_CORE_DEVICE_IDS = new Set<string>([
    "sp_hub_1",
])

export const createRegistryQuery = (): RegistryQuery => {
    return {
        isDedicatedLogisticsDevice(definitionId) {
            return DEDICATED_LOGISTICS_DEVICE_IDS.has(definitionId)
        },
        resolveDedicatedLogisticsKind(definitionId) {
            return DEDICATED_LOGISTICS_DEVICE_KINDS.get(definitionId) ?? null
        },
        isGeneralLogisticsDevice(definitionId) {
            return GENERAL_LOGISTICS_DEVICE_IDS.has(definitionId)
        },
        isProtocolCore(definitionId) {
            return PROTOCOL_CORE_DEVICE_IDS.has(definitionId)
        },
        isItemLiquid(itemId) {
            return ITEM_DOMAIN_BY_ID.get(itemId) === "liquid"
        },
        resolveItemDomain(itemId) {
            return ITEM_DOMAIN_BY_ID.get(itemId) ?? "solid"
        },
        buildWarehouseSlotLinkForEntity({
            entityId,
            storageSlotGroupId,
            slotId,
            itemId,
        }) {
            return {
                id: "",
                linkType: "share-all",
                source: { entityId, storageSlotGroupId, slotId },
                target: {
                    entityId: "warehouse",
                    storageSlotGroupId: "warehouse",
                    slotId: itemId,
                },
            };
        },
    }
}
