import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition, EntityAcceptRuleDefinition } from "@/domain/registry/types/entity-definition";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { GridEdge, GridPoint, GridRotation } from "@/domain/shared/grid";
import { hasDomain, ItemDomainFlag } from "@/domain/shared/item-domain-flags";
import { LOGISTICS_KIND, type LogisticsKind, type LogisticsRole } from "@/domain/shared/logistics";
import { BELT_TRANSPORT_DURATION_SECONDS, PIPE_TRANSPORT_DURATION_SECONDS } from "@/domain/registry";
import { resolveRotatedPortGeometry, rotateGridEdge } from "@/shared/geometry/port";
import { INSPECTOR_TYPE } from "@/domain/registry/types/entity-inspector";

export const ROTATIONS: readonly GridRotation[] = [0, 90, 180, 270];
export const EDGES: readonly GridEdge[] = ["NORTH", "EAST", "SOUTH", "WEST"];
export const DELTAS: readonly GridPoint[] = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];

export interface PlannerPort {
  readonly entityId: string;
  readonly groupIndex: number;
  readonly portIndex: number;
  readonly kind: LogisticsKind;
  readonly direction: "input" | "output";
  readonly cell: GridPoint;
  readonly outside: GridPoint;
  readonly edge: GridEdge;
}

export function itemLogisticsKind(registry: RegistryContract, itemId: string): LogisticsKind {
  const domain = registry.queries.resolveItemDomain(itemId);
  if (domain === null) throw new Error(`未知物品：${itemId}`);
  return domain === ItemDomainFlag.Solid ? LOGISTICS_KIND.belt : LOGISTICS_KIND.pipe;
}

export function transportCapacity(kind: LogisticsKind): number {
  return 60 / (kind === LOGISTICS_KIND.belt ? BELT_TRANSPORT_DURATION_SECONDS : PIPE_TRANSPORT_DURATION_SECONDS);
}

/** 只采用 Registry 明确允许的双向异族重叠，不把同族交叉或设备本体视为空地。 */
export function allowsPlannerOverlap(registry: RegistryContract, left: EntityDefinition, right: EntityDefinition): boolean {
  if (registry.queries.isPipeFamily(left.id) === registry.queries.isPipeFamily(right.id)) return false;
  const permits = (host: EntityDefinition, type: "allow-belt-overlap" | "allow-pipe-overlap") =>
    host.placementBehaviors.some(behavior => behavior.type === type);
  return permits(left, "allow-belt-overlap") && permits(right, "allow-pipe-overlap")
    || permits(left, "allow-pipe-overlap") && permits(right, "allow-belt-overlap");
}

export function acceptsItem(registry: RegistryContract, rule: EntityAcceptRuleDefinition, itemId: string): boolean {
  if (rule.exclude.includes(itemId)) return false;
  if (rule.base.kind === "item") return rule.base.itemId === itemId;
  return rule.base.kind === "domain" && hasDomain(rule.base.flags, registry.queries.resolveItemDomain(itemId) ?? 0);
}

export function getPlannerPorts(
  registry: RegistryContract,
  entity: WorldEntity,
  definition: EntityDefinition,
  direction: "input" | "output",
  itemId?: string,
  storageGroupIds?: readonly string[],
): PlannerPort[] {
  return definition.portGroups.flatMap((group, groupIndex) => {
    if (group.direction !== direction && group.direction !== "bidirectional") return [];
    if (storageGroupIds !== undefined && !definition.portStorageBindings.some((binding) =>
      binding.portGroupId === group.id && storageGroupIds.includes(binding.storageSlotGroupId))) return [];
    return group.ports.flatMap((port, portIndex) => {
      // 可配置输出口的默认 none 表示尚未选物品，不表示没有物理运力；实际启用仍由 restrictPort 写入配置。
      const configurableOutput = direction === "output" && definition.inspectors.some(inspector =>
        inspector.type === INSPECTOR_TYPE.portOutputConfig && inspector.portGroupIds.includes(group.id));
      if (itemId !== undefined && !acceptsItem(registry, port.acceptRule, itemId)
        && !(configurableOutput && port.acceptRule.base.kind === "none"
          && hasDomain(group.kind, registry.queries.resolveItemDomain(itemId) ?? 0))) return [];
      const geometry = resolveRotatedPortGeometry({ footprint: definition.footprint, port, rotation: entity.rotation });
      const cell = { x: entity.position.x + geometry.cell.x, y: entity.position.y + geometry.cell.y };
      return [{
        entityId: entity.id, groupIndex, portIndex, direction,
        kind: group.isPipe ? LOGISTICS_KIND.pipe : LOGISTICS_KIND.belt,
        cell, edge: geometry.edge,
        outside: { x: cell.x + geometry.delta.x, y: cell.y + geometry.delta.y },
      }];
    });
  });
}

export function opposite(edge: GridEdge): GridEdge { return EDGES[(EDGES.indexOf(edge) + 2) % 4]!; }
export function cellKey(point: GridPoint): string { return `${point.x},${point.y}`; }

/** 从注册表端口推导形状及旋转，不保存另一份端口方向事实表。 */
export function resolveTransportPose(
  registry: RegistryContract, kind: LogisticsKind, from: GridEdge, to: GridEdge,
): { definitionId: string; rotation: GridRotation } {
  for (const shape of ["straight", "turn-cw", "turn-ccw"] as const) {
    const definitionId = registry.queries.resolveLogisticsDefinitionId(kind, shape);
    const definition = registry.queries.findEntityDefinition(definitionId)!;
    const input = definition.portGroups.find((group) => group.direction === "input")?.ports[0];
    const output = definition.portGroups.find((group) => group.direction === "output")?.ports[0];
    if (input === undefined || output === undefined) continue;
    for (const rotation of ROTATIONS) {
      if (rotateGridEdge(input.edge, rotation) === from && rotateGridEdge(output.edge, rotation) === to) {
        return { definitionId, rotation };
      }
    }
  }
  throw new Error(`无合法物流朝向：${kind} ${from} → ${to}`);
}

export function findLogisticsDevice(registry: RegistryContract, kind: LogisticsKind, role: LogisticsRole): EntityDefinition {
  const definition = registry.entityDefinitions.find((entry) =>
    registry.queries.resolveLogisticsRole(entry.id) === role
    && (kind === LOGISTICS_KIND.belt ? registry.queries.isBeltLogistics(entry.id) : registry.queries.isPipeLogistics(entry.id)));
  if (definition === undefined) throw new Error(`缺少物流设备定义：${kind}/${role}`);
  return definition;
}

export function filterPort(entity: WorldEntity, port: PlannerPort, itemId: string): void {
  entity.config[`portGroups[${port.groupIndex}].ports[${port.portIndex}].acceptRule`] = {
    base: { kind: "item", itemId }, exclude: [],
  } satisfies EntityAcceptRuleDefinition;
}

/** 已有设备端口的有效过滤；候选构网可用的物理端口仍由 getPlannerPorts 枚举。 */
export function plannerPortAcceptsItem(registry: RegistryContract, entity: WorldEntity, definition: EntityDefinition,
  port: PlannerPort, itemId: string): boolean {
  const original = definition.portGroups[port.groupIndex]!.ports[port.portIndex]!.acceptRule;
  const rule = structuredClone(original);
  const path = ["portGroups", String(port.groupIndex), "ports", String(port.portIndex), "acceptRule"];
  const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object";
  const merge = (target: Record<string, unknown>, value: Record<string, unknown>) => {
    for (const [key, entry] of Object.entries(value)) {
      if (key === "__proto__" || key === "prototype" || key === "constructor") continue;
      if (object(target[key]) && object(entry)) merge(target[key], entry);
      else target[key] = structuredClone(entry);
    }
  };
  for (const [key, configured] of Object.entries(entity.config)) {
    const parts = key.replace(/\[(\d+)\]/g, ".$1").split(".");
    const common = Math.min(parts.length, path.length);
    if (parts.slice(0, common).some((part, index) => part !== path[index])) continue;
    let value: unknown = configured;
    for (const part of path.slice(parts.length)) value = object(value) ? value[part] : undefined;
    const remainder = parts.slice(path.length);
    const update = remainder.reduceRight<unknown>((value, part) => ({ [part]: value }), value);
    if (object(update)) merge(rule as unknown as Record<string, unknown>, update);
  }
  return acceptsItem(registry, rule, itemId);
}
