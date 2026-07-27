import {
  LOGISTICS_KIND,
  LOGISTICS_KINDS,
  type LogisticsKind,
  type LogisticsPathShape,
  type LogisticsRole,
} from "@/domain/shared/logistics";

/**
 * 传送带节和管道节 definition ID 的 registry 内部唯一事实源。
 *
 * 此常量不得从 registry 公共出口导出；registry 外只能通过 RegistryQuery 查询。
 */
export const LOGISTICS_DEFINITION_ID_BY_KIND_AND_SHAPE = {
  [LOGISTICS_KIND.belt]: {
    straight: "belt_straight_1x1",
    "turn-cw": "belt_turn_cw_1x1",
    "turn-ccw": "belt_turn_ccw_1x1",
  },
  [LOGISTICS_KIND.pipe]: {
    straight: "pipe_straight_1x1",
    "turn-cw": "pipe_turn_cw_1x1",
    "turn-ccw": "pipe_turn_ccw_1x1",
  },
} as const satisfies Readonly<
  Record<LogisticsKind, Readonly<Record<LogisticsPathShape, string>>>
>;

/**
 * 传送带物流设备和管道物流设备 definition ID 的 registry 内部唯一事实源。
 *
 * 物流设备仅包含分流器、汇流器、桥接器和准入口：
 * 传送带物流设备不包括传送带节，管道物流设备不包括管道节。
 */
export const LOGISTICS_DEFINITION_ID_BY_KIND_AND_ROLE = {
  [LOGISTICS_KIND.belt]: {
    splitter: "log_splitter",
    converger: "log_converger",
    connector: "log_connector",
    admission: "log_admission",
  },
  [LOGISTICS_KIND.pipe]: {
    splitter: "pipe_splitter",
    converger: "pipe_converger",
    connector: "pipe_connector",
    admission: "pipe_admission",
  },
} as const satisfies Readonly<
  Record<LogisticsKind, Readonly<Record<LogisticsRole, string>>>
>;

const LOGISTICS_ROLES: readonly LogisticsRole[] = [
  "splitter",
  "converger",
  "connector",
  "admission",
];

const SEGMENT_DEFINITION_IDS_BY_KIND: Readonly<
  Record<LogisticsKind, ReadonlySet<string>>
> = {
  [LOGISTICS_KIND.belt]: new Set(
    Object.values(LOGISTICS_DEFINITION_ID_BY_KIND_AND_SHAPE[LOGISTICS_KIND.belt]),
  ),
  [LOGISTICS_KIND.pipe]: new Set(
    Object.values(LOGISTICS_DEFINITION_ID_BY_KIND_AND_SHAPE[LOGISTICS_KIND.pipe]),
  ),
};

const LOGISTICS_DEFINITION_IDS_BY_KIND: Readonly<
  Record<LogisticsKind, ReadonlySet<string>>
> = {
  [LOGISTICS_KIND.belt]: new Set(
    Object.values(LOGISTICS_DEFINITION_ID_BY_KIND_AND_ROLE[LOGISTICS_KIND.belt]),
  ),
  [LOGISTICS_KIND.pipe]: new Set(
    Object.values(LOGISTICS_DEFINITION_ID_BY_KIND_AND_ROLE[LOGISTICS_KIND.pipe]),
  ),
};

const LOGISTICS_ROLE_BY_DEFINITION_ID = new Map<string, LogisticsRole>(
  LOGISTICS_KINDS.flatMap((kind) =>
    LOGISTICS_ROLES.map((role) => [
      LOGISTICS_DEFINITION_ID_BY_KIND_AND_ROLE[kind][role],
      role,
    ] as const),
  ),
);

/** registry 内部使用：判定 definition ID 是否为指定族的物流节。 */
export function isLogisticsSegmentDefinitionId(
  kind: LogisticsKind,
  definitionId: string,
): boolean {
  return SEGMENT_DEFINITION_IDS_BY_KIND[kind].has(definitionId);
}

/**
 * registry 内部使用：判定 definition ID 是否为指定族的物流设备。
 * 传送带物流设备不包括传送带节，管道物流设备不包括管道节。
 */
export function isLogisticsEquipmentDefinitionId(
  kind: LogisticsKind,
  definitionId: string,
): boolean {
  return LOGISTICS_DEFINITION_IDS_BY_KIND[kind].has(definitionId);
}

/** registry 内部使用：判定 definition ID 是否属于指定物流族。 */
export function isLogisticsFamilyDefinitionId(
  kind: LogisticsKind,
  definitionId: string,
): boolean {
  return isLogisticsSegmentDefinitionId(kind, definitionId)
    || isLogisticsEquipmentDefinitionId(kind, definitionId);
}

/** registry 内部使用：解析物流设备角色；物流节和非物流设备返回 null。 */
export function resolveLogisticsRoleByDefinitionId(
  definitionId: string,
): LogisticsRole | null {
  return LOGISTICS_ROLE_BY_DEFINITION_ID.get(definitionId) ?? null;
}
