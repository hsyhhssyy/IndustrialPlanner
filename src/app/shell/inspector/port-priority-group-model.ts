import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import {
  DEFAULT_PORT_PRIORITY_GROUP,
  isCustomPortPriorityGroupsEnabled,
  normalizePortPriorityGroup,
  readPortPriorityGroupOverrides,
  resolvePortPriorityGroupOverrideKey,
} from "@/shared/port-priority-groups";
import {
  resolveSharedOutputPortGroupIds,
  resolveOutputPortGroupNumbering,
  resolvePortTone,
  type PortGroupDefinition,
} from "@/app/shell/inspector/port-output-config-model";

export interface PortPriorityGroupPortRow {
  readonly portGroup: PortGroupDefinition;
  readonly portGroupIndex: number;
  readonly port: PortGroupDefinition["ports"][number];
  readonly portIndex: number;
  readonly portKey: string;
  readonly groupLabel: string;
  readonly portLabel: string;
  readonly priorityLabel: string;
  readonly priorityGroup: number;
  readonly portKind: PortGroupDefinition["kind"];
  readonly isPipe: boolean;
}

export function canConfigurePortPriorityGroups(definition: EntityDefinition): boolean {
  return countPorts(definition) >= 2;
}

export function resolvePortPriorityGroupRows(
  definition: EntityDefinition,
  entity: WorldEntity,
): PortPriorityGroupPortRow[] {
  const customEnabled = isCustomPortPriorityGroupsEnabled(entity.config);
  const overrides = readPortPriorityGroupOverrides(entity.config);
  const groupLabelById = resolvePortGroupLabelMap(definition);
  const rows: PortPriorityGroupPortRow[] = [];

  definition.portGroups.forEach((portGroup, portGroupIndex) => {
    const groupLabel = groupLabelById.get(portGroup.id) ?? `P${groupLabelById.size + 1}`;

    portGroup.ports.forEach((port, portIndex) => {
      const portKey = resolvePortPriorityGroupOverrideKey(portGroup.id, port.id);
      const priorityGroup = customEnabled
        ? normalizePortPriorityGroup(overrides[portKey])
        : normalizePortPriorityGroup(port.priorityGroup);

      rows.push({
        portGroup,
        portGroupIndex,
        port,
        portIndex,
        portKey,
        groupLabel,
        portLabel: `${groupLabel}.${portIndex + 1}`,
        priorityLabel: String(priorityGroup),
        priorityGroup,
        portKind: resolvePortTone(portGroup),
        isPipe: portGroup.isPipe,
      });
    });
  });

  return rows.sort(comparePortPriorityRows);
}

export function resolvePortPriorityCalloutRows(
  definition: EntityDefinition,
  entity: WorldEntity,
): PortPriorityGroupPortRow[] {
  if (
    !canConfigurePortPriorityGroups(definition)
    || !isCustomPortPriorityGroupsEnabled(entity.config)
  ) {
    return [];
  }

  return resolvePortPriorityGroupRows(definition, entity).map((row) => ({
    ...row,
    portLabel: `${row.portLabel}-G${row.priorityGroup}`,
  }));
}

export function resolveNextPortPriorityGroupOverrides(
  currentConfig: Readonly<Record<string, unknown>>,
  portKey: string,
  priorityGroup: number,
): Record<string, number> {
  const current = readPortPriorityGroupOverrides(currentConfig);
  const next: Record<string, number> = {};

  for (const [key, value] of Object.entries(current)) {
    const normalizedValue = normalizePortPriorityGroup(value);
    if (normalizedValue !== DEFAULT_PORT_PRIORITY_GROUP) {
      next[key] = normalizedValue;
    }
  }

  const normalizedPriorityGroup = normalizePortPriorityGroup(priorityGroup);
  if (normalizedPriorityGroup === DEFAULT_PORT_PRIORITY_GROUP) {
    delete next[portKey];
  } else {
    next[portKey] = normalizedPriorityGroup;
  }

  return next;
}

function resolvePortGroupLabelMap(definition: EntityDefinition): Map<string, string> {
  const labels = new Map<string, string>();
  const outputPortGroupIds = resolveSharedOutputPortGroupIds(definition);

  for (const numberedGroup of resolveOutputPortGroupNumbering(definition, outputPortGroupIds)) {
    labels.set(numberedGroup.portGroup.id, numberedGroup.portLabel);
  }

  for (const portGroup of definition.portGroups) {
    if (labels.has(portGroup.id)) {
      continue;
    }

    labels.set(portGroup.id, `P${labels.size + 1}`);
  }

  return labels;
}

function countPorts(definition: EntityDefinition): number {
  return definition.portGroups.reduce(
    (sum, portGroup) => sum + portGroup.ports.length,
    0,
  );
}

function comparePortPriorityRows(
  left: PortPriorityGroupPortRow,
  right: PortPriorityGroupPortRow,
): number {
  return resolvePortGroupLabelOrder(left.groupLabel) - resolvePortGroupLabelOrder(right.groupLabel)
    || left.portIndex - right.portIndex
    || left.portGroupIndex - right.portGroupIndex
    || left.port.id.localeCompare(right.port.id);
}

function resolvePortGroupLabelOrder(label: string): number {
  const parsed = Number.parseInt(label.slice(1), 10);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}
