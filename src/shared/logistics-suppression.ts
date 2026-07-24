import type { LogisticsKind } from "@/domain/shared/logistics";

const ORDINARY_LOGISTICS_DEFINITION_IDS_BY_FAMILY: Readonly<Record<LogisticsKind, ReadonlySet<string>>> = {
  belt: new Set([
    "belt_straight_1x1",
    "belt_turn_cw_1x1",
    "belt_turn_ccw_1x1",
  ]),
  pipe: new Set([
    "pipe_straight_1x1",
    "pipe_turn_cw_1x1",
    "pipe_turn_ccw_1x1",
  ]),
};

const ACCESSORY_LOGISTICS_DEFINITION_IDS_BY_FAMILY: Readonly<Record<LogisticsKind, ReadonlySet<string>>> = {
  belt: new Set([
    "log_connector",
    "log_converger",
    "log_splitter",
    "log_admission",
  ]),
  pipe: new Set([
    "pipe_connector",
    "pipe_converger",
    "pipe_splitter",
    "pipe_admission",
  ]),
};

export function resolveLogisticsSuppressionFamily(
  definitionId: string,
): LogisticsKind | null {
  for (const family of ["belt", "pipe"] as const) {
    if (
      ORDINARY_LOGISTICS_DEFINITION_IDS_BY_FAMILY[family].has(definitionId)
      || ACCESSORY_LOGISTICS_DEFINITION_IDS_BY_FAMILY[family].has(definitionId)
    ) {
      return family;
    }
  }

  return null;
}

export function resolveAccessoryLogisticsSuppressionFamily(
  definitionId: string,
): LogisticsKind | null {
  for (const family of ["belt", "pipe"] as const) {
    if (ACCESSORY_LOGISTICS_DEFINITION_IDS_BY_FAMILY[family].has(definitionId)) {
      return family;
    }
  }

  return null;
}

export function isLogisticsDefinitionSuppressed(options: {
  readonly definitionId: string;
  readonly suppressBelts: boolean;
  readonly suppressPipes: boolean;
}): boolean {
  const family = resolveLogisticsSuppressionFamily(options.definitionId);
  return (
    (family === "belt" && options.suppressBelts)
    || (family === "pipe" && options.suppressPipes)
  );
}
