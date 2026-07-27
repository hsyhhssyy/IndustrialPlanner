import type { RegistryQuery } from "@/domain/registry/registry-query"
import { LOGISTICS_KIND } from "@/domain/shared/logistics"
import type { ItemDomain } from "@/domain/registry/types/entity-definition"
import { ITEM_DEFINITIONS } from "./item-definition"
import {
    LOGISTICS_DEFINITION_ID_BY_KIND_AND_SHAPE,
    isLogisticsEquipmentDefinitionId,
    isLogisticsFamilyDefinitionId,
    isLogisticsSegmentDefinitionId,
    resolveLogisticsRoleByDefinitionId,
} from "./logistics-definition-ids"

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
 * AI-CORRECTION 2026-07-27: “专用物流设备”现称为传送带节或管道节；
 * “通用物流设备”现称为传送带物流设备或管道物流设备，且分别不包括对应路径节。
 *
 * 原因：这些设备有自己的 buffer 和独立搬运配方，不应受管道/传送带域锁约束，
 * 且应分割 TransportComponent 连通分量。这是仿真设计的明确规定。
 */
// AI-REMOVED 2026-07-27:
// Reason: registry Query 不应维护第二份设备 ID 分类；传送带节、管道节和物流设备均改由 registry 内部唯一事实表派生。
// Trigger: 用户要求 ID 归 registry 内部常量所有，registry 外只通过 Query 访问，并统一传送带/管道名词。
// Evidence: logistics-definition-ids.ts 已按 kind+shape 与 kind+role 建立唯一事实表。
// Replacement: LOGISTICS_DEFINITION_ID_BY_KIND_AND_SHAPE、isLogisticsSegmentDefinitionId、
//   isLogisticsEquipmentDefinitionId、isLogisticsFamilyDefinitionId。
// Risk: Low - RegistryQuery 的兼容方法仍保留，但由新分类派生。
// Human Review: Required
//
// Original code:
// const DEDICATED_LOGISTICS_DEVICE_KINDS = new Map<string, LogisticsKind>([
//     ["belt_straight_1x1", "belt"],
//     ["belt_turn_cw_1x1", "belt"],
//     ["belt_turn_ccw_1x1", "belt"],
//     ["pipe_straight_1x1", "pipe"],
//     ["pipe_turn_cw_1x1", "pipe"],
//     ["pipe_turn_ccw_1x1", "pipe"],
// ])
//
// const DEDICATED_LOGISTICS_DEVICE_IDS = new Set<string>(
//     DEDICATED_LOGISTICS_DEVICE_KINDS.keys(),
// )
//
// const GENERAL_LOGISTICS_DEVICE_IDS = new Set<string>([
//     ...DEDICATED_LOGISTICS_DEVICE_IDS,
//     "log_splitter",
//     "log_converger",
//     "log_connector",
//     "log_admission",
//     "pipe_splitter",
//     "pipe_converger",
//     "pipe_connector",
//     "pipe_admission",
// ])

const PROTOCOL_CORE_DEVICE_IDS = new Set<string>([
    "sp_hub_1",
])

export const createRegistryQuery = (): RegistryQuery => {
    return {
        isBelt(definitionId) {
            return isLogisticsSegmentDefinitionId(LOGISTICS_KIND.belt, definitionId)
        },
        isBeltLogistics(definitionId) {
            return isLogisticsEquipmentDefinitionId(LOGISTICS_KIND.belt, definitionId)
        },
        isBeltFamily(definitionId) {
            return isLogisticsFamilyDefinitionId(LOGISTICS_KIND.belt, definitionId)
        },
        isPipe(definitionId) {
            return isLogisticsSegmentDefinitionId(LOGISTICS_KIND.pipe, definitionId)
        },
        isPipeLogistics(definitionId) {
            return isLogisticsEquipmentDefinitionId(LOGISTICS_KIND.pipe, definitionId)
        },
        isPipeFamily(definitionId) {
            return isLogisticsFamilyDefinitionId(LOGISTICS_KIND.pipe, definitionId)
        },
        resolveLogisticsDefinitionId(kind, shape) {
            return LOGISTICS_DEFINITION_ID_BY_KIND_AND_SHAPE[kind][shape]
        },
        resolveLogisticsRole(definitionId) {
            return resolveLogisticsRoleByDefinitionId(definitionId)
        },
        isDedicatedLogisticsDevice(definitionId) {
            return isLogisticsSegmentDefinitionId(LOGISTICS_KIND.belt, definitionId)
                || isLogisticsSegmentDefinitionId(LOGISTICS_KIND.pipe, definitionId)
        },
        resolveDedicatedLogisticsKind(definitionId) {
            if (isLogisticsSegmentDefinitionId(LOGISTICS_KIND.belt, definitionId)) {
                return LOGISTICS_KIND.belt
            }
            if (isLogisticsSegmentDefinitionId(LOGISTICS_KIND.pipe, definitionId)) {
                return LOGISTICS_KIND.pipe
            }
            return null
        },
        isGeneralLogisticsDevice(definitionId) {
            return isLogisticsFamilyDefinitionId(LOGISTICS_KIND.belt, definitionId)
                || isLogisticsFamilyDefinitionId(LOGISTICS_KIND.pipe, definitionId)
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
