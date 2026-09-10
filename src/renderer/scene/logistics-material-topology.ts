import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { RegistryQuery } from "@/domain/registry/registry-query";
import { FluidDomain } from "@/domain/shared/item-domain-flags";
import { resolveRotatedPortGeometry } from "@/shared/geometry/port";
import {
  resolveLogisticsMaterialPlacements, resolveLogisticsMaterialSpec,
  type LogisticsMaterialPathEntry,
} from "@/shared/logistics-material";

/** 将设备真实端口与材质线路关联；虚影替换重叠节后接续线路，仿真分组仍使用正式实体。 */
export function resolveLogisticsMaterialTopology(options: {
  entities: readonly WorldEntity[];
  definitions: ReadonlyMap<string, EntityDefinition>;
  registry: Pick<RegistryQuery, "isPipe" | "isBelt">;
  hiddenEntityIds?: ReadonlySet<string>;
  replacingEntityId?: string | null;
}) {
  const actual = options.entities.filter((entity) => !("originalEntityId" in entity));
  const drafts = options.entities.filter((entity) => "originalEntityId" in entity);
  const collect = (entities: readonly WorldEntity[]) => {
    const entries = new Map<string, LogisticsMaterialPathEntry>();
    const devices: { entity: WorldEntity; definition: EntityDefinition }[] = [];
    const deviceInputs = new Set<string>();
    const deviceOutputs = new Set<string>();
    for (const entity of entities) {
      const definition = options.definitions.get(entity.definitionId);
      if (!definition) continue;
      const spec = resolveLogisticsMaterialSpec(definition.spriteId);
      if (spec && (options.registry.isPipe(definition.id) || options.registry.isBelt(definition.id))) {
        const turns = (entity.rotation + spec.rotation) / 90;
        const inputSide = (turns + 4) % 4;
        const outputSide = (turns + (spec.shape === "straight" ? 2 : spec.shape === "left" ? 3 : 1)) % 4;
        const key = (side: number, reverse: boolean) => {
          const dx = [0, 1, 0, -1][side]!;
          const dy = [-1, 0, 1, 0][side]!;
          return `${entity.position.x * 2 + 1 + dx},${entity.position.y * 2 + 1 + dy}:${reverse ? (side + 2) % 4 : side}`;
        };
        // 相同位置的绘制虚影覆盖正式节，避免起笔替换转角时产生两条相同输入边。
        entries.set(`${spec.kind}:${entity.position.x},${entity.position.y}`, {
          ...spec, id: entity.id, input: key(inputSide, false), output: key(outputSide, true),
        });
        continue;
      }
      devices.push({ entity, definition });
    }
    // 无管道时不收集设备端口；设备和传送带场景无需承担管道连接判断的成本。
    if (![...entries.values()].some((entry) => entry.kind === "pipe")) {
      return resolveLogisticsMaterialPlacements([...entries.values()]);
    }
    for (const { entity, definition } of devices) {
      for (const group of definition.portGroups) {
        if (!group.isPipe || (group.kind & FluidDomain) === 0) continue;
        for (const port of group.ports) {
          const { cell, delta } = resolveRotatedPortGeometry({ footprint: definition.footprint, port, rotation: entity.rotation });
          const side = delta.y === -1 ? 0 : delta.x === 1 ? 1 : delta.y === 1 ? 2 : 3;
          const boundary = `${(entity.position.x + cell.x) * 2 + 1 + delta.x},${(entity.position.y + cell.y) * 2 + 1 + delta.y}`;
          if (group.direction !== "output") deviceInputs.add(`${boundary}:${side}`);
          if (group.direction !== "input") deviceOutputs.add(`${boundary}:${(side + 2) % 4}`);
        }
      }
    }
    return resolveLogisticsMaterialPlacements([...entries.values()].map((entry) => ({
      ...entry,
      inputConnectedToDevice: entry.kind === "pipe" && deviceOutputs.has(entry.input),
      outputConnectedToDevice: entry.kind === "pipe" && deviceInputs.has(entry.output),
    })));
  };
  const committed = collect(actual);
  const placements = drafts.length === 0 ? committed : new Map([
    ...committed,
    ...collect([
      ...actual.filter((entity) => !options.hiddenEntityIds?.has(entity.id) && entity.id !== options.replacingEntityId),
      ...drafts,
    ]),
  ]);
  return { committed, placements, previewIds: new Set(drafts.map((entity) => entity.id)) };
}
