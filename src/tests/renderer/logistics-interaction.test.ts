import { describe, expect, it } from 'vitest';
import { createRegistryContract } from '@/registry';
import type { WorldEntity } from '@/domain/document/world-document';
import type { EntityCollection, EntityCollections } from '@/domain/editor/types/editor-types';
import { resolveConnectableLogistics, resolveLogisticsEffects } from '@/renderer/scene/logistics-interaction';

const registry = createRegistryContract();
const definitions = new Map(registry.entityDefinitions.map((d) => [d.id, d]));
const entity = (id: string, definitionId: string, x: number, y = 0, rotation: WorldEntity['rotation'] = 0): WorldEntity =>
  ({ id, definitionId, position: { x, y }, rotation, config: {}, tags: [] });
const collection = (...ids: string[]): EntityCollection => Object.assign(ids, { contains: (id: string) => ids.includes(id) });
const collections = (patch: Partial<EntityCollections> = {}): EntityCollections => ({
  selection: collection(), marquee: collection(), 'reverse-marquee': collection(), preview: collection(),
  ghost: collection(), 'logistics-head': collection(), powered: collection(), 'invalid-placement': collection(), ...patch,
});

describe('物流状态与合法连接', () => {
  it.each([['pipe_straight_1x1', 'pipe_connector'], ['belt_straight_1x1', 'log_connector']])(
    '%s 四向桥接只标记相连线路，穿过连续段但不越过设备', (line, bridge) => {
      const entities = [entity('preview', bridge, 0), entity('west', line, -1), entity('east', line, 1),
        entity('north', line, 0, -1, 90), entity('south', line, 0, 1, 90), entity('far', line, -2),
        entity('stop', bridge, -3), entity('beyond', line, -4), entity('nearby', line, 2, 1)];
      expect(resolveConnectableLogistics({ entities, definitions, preview: new Set(['preview']), invalid: new Set(), hidden: new Set() }))
        .toEqual(new Set(['west', 'east', 'north', 'south', 'far']));
    });

  it('反向端口、不同物流类型、无效和被替换实体均不产生提示', () => {
    const preview = entity('preview', 'pipe_straight_1x1', 0);
    const options = { entities: [preview, entity('opposite', 'pipe_straight_1x1', 1, 0, 180),
      entity('belt', 'belt_straight_1x1', -1)], definitions, preview: new Set(['preview']), invalid: new Set<string>(), hidden: new Set<string>() };
    expect(resolveConnectableLogistics(options).size).toBe(0);
    options.entities[1] = entity('valid', 'pipe_straight_1x1', 1);
    expect(resolveConnectableLogistics(options)).toEqual(new Set(['valid']));
    expect(resolveConnectableLogistics({ ...options, invalid: new Set(['preview']) }).size).toBe(0);
    expect(resolveConnectableLogistics({ ...options, hidden: new Set(['valid']) }).size).toBe(0);
  });

  it('传送带悬浮不改材质；选中覆盖可连接；反向框选恢复连接提示', () => {
    const entities = [entity('preview', 'pipe_connector', 0), entity('pipe', 'pipe_straight_1x1', 1), entity('belt', 'belt_straight_1x1', 4)];
    const options = { entities, definitions, hoverId: 'belt', collections: collections() };
    expect(resolveLogisticsEffects(options).size).toBe(0);
    expect(resolveLogisticsEffects({ ...options, hoverId: 'pipe' }).get('pipe')).toBe('hover');
    const c = collections({ preview: collection('preview'), selection: collection('pipe') });
    expect(resolveLogisticsEffects({ ...options, collections: c }).get('pipe')).toBe('selected');
    expect(resolveLogisticsEffects({ ...options, collections: { ...c, 'reverse-marquee': collection('pipe') } }).get('pipe')).toBe('connectable');
    expect(resolveLogisticsEffects({ ...options, collections: c, invalidDraft: true }).has('preview')).toBe(false);
  });
});
