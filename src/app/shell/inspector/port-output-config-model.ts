import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";

export type PortGroupDefinition = EntityDefinition["portGroups"][number];

export interface OutputGroupRow {
  readonly portGroup: PortGroupDefinition;
  readonly groupIndex: number;
  readonly currentItemId: string | null;
  readonly label: string;
  readonly portLabel: string;
}

export function resolveOutputGroupRows(
  definition: EntityDefinition,
  portGroupIds: readonly string[],
  entity: WorldEntity,
): OutputGroupRow[] {
  const rows: OutputGroupRow[] = [];

  for (const portGroupId of portGroupIds) {
    const groupIndex = definition.portGroups.findIndex((g) => g.id === portGroupId);
    if (groupIndex < 0) continue;
    const portGroup = definition.portGroups[groupIndex];
    if (portGroup === undefined) continue;
    if (portGroup.direction !== "output") continue;

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

    const kindLabel = portGroup.kind === "fluid" ? "液体输出" : "固体输出";

    rows.push({
      portGroup,
      groupIndex,
      currentItemId,
      label: kindLabel,
      portLabel: `P${rows.length + 1}`,
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
export function resolvePortTone(portGroup: PortGroupDefinition): "item" | "fluid" {
  return portGroup.kind === "fluid" ? "fluid" : "item";
}
