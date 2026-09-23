import type { WorldEntity } from '@/domain/document/world-document';
import type { EntityDefinition, PortGroupDefinition } from '@/domain/registry/types/entity-definition';
import type { EntityCollections } from '@/domain/editor/types/editor-types';
import { resolveRotatedPortGeometry } from '@/shared/geometry/port';
import { resolveLogisticsMaterialSpec, type LogisticsMaterialEffect } from '@/shared/logistics-material';

interface Endpoint {
  id: string;
  inside: string;
  outside: string;
  group: PortGroupDefinition;
}

/** 双向端口坐标、方向和物品域都匹配才算连接；遍历在普通设备处终止。 */
export function resolveConnectableLogistics(options: {
  entities: readonly WorldEntity[];
  definitions: ReadonlyMap<string, EntityDefinition>;
  preview: ReadonlySet<string>;
  invalid: ReadonlySet<string>;
  hidden: ReadonlySet<string>;
}): ReadonlySet<string> {
  if (options.preview.size === 0) return new Set();
  const ports = new Map<string, Endpoint[]>();
  const dedicated = new Set<string>();
  for (const entity of options.entities) {
    if (options.hidden.has(entity.id) || options.invalid.has(entity.id)) continue;
    const definition = options.definitions.get(entity.definitionId);
    if (!definition) continue;
    if (resolveLogisticsMaterialSpec(definition.spriteId)) dedicated.add(entity.id);
    for (const group of definition.portGroups) for (const port of group.ports) {
      const { cell, delta } = resolveRotatedPortGeometry({ footprint: definition.footprint, port, rotation: entity.rotation });
      const x = entity.position.x + cell.x, y = entity.position.y + cell.y;
      const endpoint = { id: entity.id, inside: `${x},${y}`, outside: `${x + delta.x},${y + delta.y}`, group };
      const key = `${endpoint.inside}>${endpoint.outside}`;
      const list = ports.get(key) ?? [];
      list.push(endpoint); ports.set(key, list);
    }
  }
  const adjacency = new Map<string, Set<string>>();
  for (const entries of ports.values()) for (const a of entries) {
    for (const b of ports.get(`${a.outside}>${a.inside}`) ?? []) {
      if (a.id === b.id || a.group.isPipe !== b.group.isPipe || !(a.group.kind & b.group.kind)
        || (a.group.direction === b.group.direction && a.group.direction !== 'bidirectional')) continue;
      const neighbors = adjacency.get(a.id) ?? new Set<string>();
      neighbors.add(b.id); adjacency.set(a.id, neighbors);
    }
  }
  const queue = [...options.preview].filter((id) => !options.invalid.has(id));
  const visited = new Set(queue), result = new Set<string>();
  for (let index = 0; index < queue.length; index++) {
    for (const id of adjacency.get(queue[index]!) ?? []) {
      if (visited.has(id) || !dedicated.has(id)) continue;
      visited.add(id); queue.push(id);
      if (!options.preview.has(id)) result.add(id);
    }
  }
  return result;
}

export function resolveLogisticsEffects(options: {
  entities: readonly WorldEntity[];
  definitions: ReadonlyMap<string, EntityDefinition>;
  collections: EntityCollections;
  hoverId?: string | null;
  replacingId?: string | null;
  invalidDraft?: boolean;
}): ReadonlyMap<string, LogisticsMaterialEffect> {
  const c = options.collections;
  const preview = new Set(c.preview);
  const invalid = new Set(c['invalid-placement']);
  if (options.invalidDraft) for (const id of preview) invalid.add(id);
  const hidden = new Set(c.ghost);
  if (options.replacingId) hidden.add(options.replacingId);
  const connectable = resolveConnectableLogistics({ ...options, preview, invalid, hidden });
  const result = new Map<string, LogisticsMaterialEffect>();
  const selected = new Set([...c.selection].filter((id) => !c['reverse-marquee'].includes(id)));
  for (const id of c.marquee) selected.add(id);
  for (const entity of options.entities) {
    if (hidden.has(entity.id)) continue;
    const definition = options.definitions.get(entity.definitionId);
    const spec = definition && resolveLogisticsMaterialSpec(definition.spriteId);
    if (!spec) continue;
    const effect = preview.has(entity.id) ? invalid.has(entity.id) ? 'invalid' : 'preview'
      : selected.has(entity.id) ? 'selected' : connectable.has(entity.id) ? 'connectable'
      : spec.kind === 'pipe' && options.hoverId === entity.id ? 'hover' : null;
    if (effect) result.set(entity.id, effect);
  }
  return result;
}
