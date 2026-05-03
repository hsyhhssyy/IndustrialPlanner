import type { RegistryQuery } from "@/domain/query/registry-query"
import type { LogisticsKind } from "@/domain/types/logistics"

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
    }
}