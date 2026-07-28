import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import {
  INSPECTOR_TYPE,
  type PortOutputConfigInspectorDeclaration,
} from "@/domain/registry/types/entity-inspector";
import {
  FluidDomain,
  ItemDomainFlag,
  type ItemDomainFlag as ItemDomainFlags,
} from "@/domain/shared/item-domain-flags";

export type PortGroupDefinition = EntityDefinition["portGroups"][number];

export interface OutputPortGroupNumbering {
  readonly portGroup: PortGroupDefinition;
  readonly groupIndex: number;
  readonly portLabel: string;
}

export interface OutputGroupRow {
  readonly portGroup: PortGroupDefinition;
  readonly groupIndex: number;
  readonly currentItemId: string | null;
  readonly label: string;
  readonly portLabel: string;
}

export function resolveSharedOutputGroupRows(
  definition: EntityDefinition,
  entity: WorldEntity,
): OutputGroupRow[] {
  return resolveOutputGroupRows(
    definition,
    resolveSharedOutputPortGroupIds(definition),
    entity,
  );
}

export function resolveSharedOutputPortGroupIds(
  definition: EntityDefinition,
): readonly string[] {
  const outputConfigDeclaration = definition.inspectors.find(
    (inspector): inspector is PortOutputConfigInspectorDeclaration =>
      inspector.type === INSPECTOR_TYPE.portOutputConfig,
  );

  if (outputConfigDeclaration !== undefined) {
    return outputConfigDeclaration.portGroupIds;
  }

  return definition.portGroups
    .filter((portGroup) => portGroup.direction === "output")
    .map((portGroup) => portGroup.id);
}

export function resolveOutputPortGroupNumbering(
  definition: EntityDefinition,
  portGroupIds: readonly string[],
): OutputPortGroupNumbering[] {
  const numberedPortGroups: OutputPortGroupNumbering[] = [];

  for (const portGroupId of portGroupIds) {
    const groupIndex = definition.portGroups.findIndex((g) => g.id === portGroupId);
    if (groupIndex < 0) continue;
    const portGroup = definition.portGroups[groupIndex];
    if (portGroup === undefined) continue;
    if (portGroup.direction !== "output") continue;

    numberedPortGroups.push({
      portGroup,
      groupIndex,
      portLabel: `P${numberedPortGroups.length + 1}`,
    });
  }

  return numberedPortGroups;
}

export function resolveOutputGroupRows(
  definition: EntityDefinition,
  portGroupIds: readonly string[],
  entity: WorldEntity,
): OutputGroupRow[] {
  const rows: OutputGroupRow[] = [];

  for (const numberedPortGroup of resolveOutputPortGroupNumbering(definition, portGroupIds)) {
    const { groupIndex, portGroup, portLabel } = numberedPortGroup;
    const firstPortIndex = 0;
    const configPath = `portGroups[${groupIndex}].ports[${firstPortIndex}].acceptRule`;
    const configOverride = entity.config[configPath];

    let currentItemId: string | null = null;
    if (
      configOverride !== undefined
      && configOverride !== null
      && typeof configOverride === "object"
    ) {
      const base = (configOverride as Record<string, unknown>).base;
      if (
        base !== undefined
        && base !== null
        && typeof base === "object"
        && (base as Record<string, unknown>).kind === "item"
        && typeof (base as Record<string, unknown>).itemId === "string"
      ) {
        currentItemId = (base as Record<string, unknown>).itemId as string;
      }
    }

    // AI-CORRECTION 2026-07-10: fluid 输出端口不是都可承载气体；标签按端口 acceptRule 区分液体/气体/流体。
    const kindLabel = resolveOutputKindLabel(portGroup);

    rows.push({
      portGroup,
      groupIndex,
      currentItemId,
      label: kindLabel,
      portLabel,
    });
  }

  return rows;
}

/*
  AI-REMOVED 2026-06-04:
  Reason: 端口颜色不能按 P1/P2/P3 编号分色；编号已经由文字表达，颜色必须传递新增信息。
  Trigger: 用户要求颜色按传送带/管道类型传递信息，并禁止颜色与文字重复表达同一语义。
  Evidence: InspectorPanel设计风格规范已明确“端口色只表达类型，而不是端口编号”。
  Replacement: resolvePortTone(portGroup) 按 portGroup.kind 返回 item/fluid。
  Risk: Low
  Human Review: Required

  Original code:
  export function resolvePortTone(index: number): "blue" | "green" | "orange" {
    if (index === 0) {
      return "blue";
    }

    if (index === 1) {
      return "green";
    }

    return "orange";
  }
*/
// AI-CORRECTION 2026-07-28: 返回值改为域位标志；端口物理色调由 portGroup.isPipe 单独决定。
export function resolvePortTone(portGroup: PortGroupDefinition): ItemDomainFlags {
  return portGroup.kind;
}

function resolveOutputKindLabel(portGroup: PortGroupDefinition): string {
  if (!portGroup.isPipe) {
    return "固体输出";
  }

  const firstPortRule = portGroup.ports[0]?.acceptRule.base;
  const flags = firstPortRule?.kind === "domain"
    ? firstPortRule.flags
    : portGroup.kind;
  if (flags === ItemDomainFlag.Gas) {
    return "气体输出";
  }
  if (flags === FluidDomain) {
    return "流体输出";
  }
  return "液体输出";
}
