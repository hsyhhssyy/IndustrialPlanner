import type { RegistryQuery } from "@/domain/registry/registry-query";
import {
  LOGISTICS_KIND,
  type LogisticsKind,
} from "@/domain/shared/logistics";

type LogisticsClassificationQuery = Pick<
  RegistryQuery,
  "isBeltFamily" | "isBeltLogistics" | "isPipeFamily" | "isPipeLogistics"
>;

// AI-REMOVED 2026-07-27:
// Reason: shared 不应维护 registry definition ID 集合，否则会形成第二份事实源并可能与注册表漂移。
// Trigger: 用户要求设备 ID 归 registry 内部常量所有，registry 外只使用导出 Query。
// Evidence: RegistryQuery 已提供 isBeltFamily/isBeltLogistics/isPipeFamily/isPipeLogistics。
// Replacement: resolveLogisticsSuppressionKind / resolveLogisticsEquipmentSuppressionKind 的 queries 参数。
// Risk: Low - 所有调用方必须传入同一 workspace 的 RegistryQuery。
// Human Review: Required
//
// Original code:
// const ORDINARY_LOGISTICS_DEFINITION_IDS_BY_FAMILY = {
//   belt: new Set(["belt_straight_1x1", "belt_turn_cw_1x1", "belt_turn_ccw_1x1"]),
//   pipe: new Set(["pipe_straight_1x1", "pipe_turn_cw_1x1", "pipe_turn_ccw_1x1"]),
// };
// const ACCESSORY_LOGISTICS_DEFINITION_IDS_BY_FAMILY = {
//   belt: new Set(["log_connector", "log_converger", "log_splitter", "log_admission"]),
//   pipe: new Set(["pipe_connector", "pipe_converger", "pipe_splitter", "pipe_admission"]),
// };

/** 解析完整物流族；传送带族和管道设备族都包含各自的节与物流设备。 */
export function resolveLogisticsSuppressionKind(
  definitionId: string,
  queries: LogisticsClassificationQuery,
): LogisticsKind | null {
  if (queries.isBeltFamily(definitionId)) {
    return LOGISTICS_KIND.belt;
  }
  if (queries.isPipeFamily(definitionId)) {
    return LOGISTICS_KIND.pipe;
  }

  return null;
}

/**
 * 解析物流设备所属类型。
 * 传送带物流设备不包括传送带节，管道物流设备不包括管道节。
 */
export function resolveLogisticsEquipmentSuppressionKind(
  definitionId: string,
  queries: LogisticsClassificationQuery,
): LogisticsKind | null {
  if (queries.isBeltLogistics(definitionId)) {
    return LOGISTICS_KIND.belt;
  }
  if (queries.isPipeLogistics(definitionId)) {
    return LOGISTICS_KIND.pipe;
  }

  return null;
}

export function isLogisticsDefinitionSuppressed(options: {
  readonly definitionId: string;
  readonly suppressBelts: boolean;
  readonly suppressPipes: boolean;
  readonly queries: LogisticsClassificationQuery;
}): boolean {
  const family = resolveLogisticsSuppressionKind(options.definitionId, options.queries);
  return (
    (family === LOGISTICS_KIND.belt && options.suppressBelts)
    || (family === LOGISTICS_KIND.pipe && options.suppressPipes)
  );
}
