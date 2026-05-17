import type { RegistryQuery } from "@/domain/registry/registry-query"
import type { LogisticsKind } from "@/domain/shared/logistics"
import { ITEM_DEFINITIONS } from "./item-definition"

const LIQUID_ITEM_IDS = new Set(
    ITEM_DEFINITIONS
        .filter((item) => item.tags.includes("liquid"))
        .map((item) => item.id),
)

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
    "item_log_splitter",
    "item_log_converger",
    "item_log_connector",
    "item_pipe_splitter",
    "item_pipe_converger",
    "item_pipe_connector",
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
        isItemLiquid(itemId) {
            return LIQUID_ITEM_IDS.has(itemId)
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