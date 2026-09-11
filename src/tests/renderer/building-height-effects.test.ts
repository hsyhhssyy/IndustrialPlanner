import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { createRegistryContract } from '@/registry';
import type { WorldEntity } from '@/domain/document/world-document';
import type { BuildingEffectsManifest, HeightField, SurfacePlacement } from '@/renderer/building-effects/types';
import { decodeHeight, fieldBounds, rasterizeHeightTile, HEIGHT_TILE_PIXELS, tileKeys } from '@/renderer/building-effects/height-field';
import { resolveBuildingEffectScene, resolveEffectFrame } from '@/renderer/building-effects/placements';

const manifest = JSON.parse(await readFile('public/3d-top-view/port-effects/manifest.json', 'utf8')) as BuildingEffectsManifest;
const registry = createRegistryContract();
const definitions = new Map(registry.entityDefinitions.map((definition) => [definition.id, definition]));
const entity: WorldEntity = { id: 'device', definitionId: 'transmuter_1_gastrans',
  position: { x: 0, y: 0 }, rotation: 0, config: {}, tags: [] };

/** 独立的“已修正交付”夹具；产品原件保持不变，不将此镜像当作接入规则。 */
function correctedFixture() {
  const fixture = structuredClone(manifest);
  for (const ports of Object.values(fixture.views['transmuter_1/top']!.variants)) {
    for (const port of ports) { port.position[0] *= -1; port.yaw = 180; }
  }
  return fixture;
}

describe('建筑高度与端口特效', () => {
  it('按世界单位解码不同范围，空像素不遮挡；移除最高表面后恢复下层', () => {
    const field: HeightField = { file: 'fixture', width: 2, height: 1, min: -5, max: 5,
      pivot: [0, 0], center: [0, 0], pixelsPerCell: 128 };
    const data = new Map([['fixture', new Uint8Array([255, 255, 0, 255, 255, 255, 0, 0])]]);
    const surface: SurfacePlacement = { id: 'self', field, x: 0, y: 0, rotation: 0, baseY: -2 };
    const neighbor = { ...surface, id: 'neighbor', baseY: 1 };
    const composed = rasterizeHeightTile('0,0', [surface, neighbor], data, -10, 10);
    expect(decodeHeight(composed[0]!, composed[1]!, -10, 10)).toBeCloseTo(6, 3);
    expect(composed[7]).toBe(0);
    const removed = rasterizeHeightTile('0,0', [surface], data, -10, 10);
    expect(decodeHeight(removed[0]!, removed[1]!, -10, 10)).toBeCloseTo(3, 3);
    expect(rasterizeHeightTile('0,0', [], data, -10, 10).every((value) => value === 0)).toBe(true);
  });

  it('区域跨负坐标边界并保留旋转后的不对称高度与原点', () => {
    expect(tileKeys({ left: -1, top: -1, right: 1, bottom: 1 })).toEqual(['-1,-1', '0,-1', '-1,0', '0,0']);
    const field: HeightField = { file: 'fixture', width: 2, height: 1, min: 0, max: 1,
      pivot: [0, 0], center: [0, 0], pixelsPerCell: 128 };
    const surface = { id: 'rotated', field, x: 1, y: 1, rotation: 90, baseY: 0 };
    const data = new Map([['fixture', new Uint8Array([255, 255, 0, 255, 0, 0, 0, 0])]]);
    const bytes = rasterizeHeightTile('0,0', [surface], data, 0, 1);
    expect(bytes[(128 * HEIGHT_TILE_PIXELS + 127) * 4 + 3]).toBe(255);
    expect(bytes[(129 * HEIGHT_TILE_PIXELS + 127) * 4 + 3]).toBe(0);
    expect(fieldBounds(surface).left).toBeCloseTo(1 - 1 / 128);
  });

  it('原交付冲突明确拒绝绑定，不反转 Registry 或猜测环状态', () => {
    const scene = resolveBuildingEffectScene({ manifest, definitions, entities: [entity] });
    expect(scene.surfaces).toHaveLength(1);
    expect(scene.effects).toHaveLength(0);
    expect(scene.issues).toHaveLength(4);
    expect(definitions.get(entity.definitionId)!.portGroups[0]!.ports[0]!.edge).toBe('EAST');
  });

  it('使用修正夹具验证单端口 ON/OFF、反向邻居、实体旋转和移除', () => {
    const fixture = correctedFixture();
    const pipe: WorldEntity = { ...entity, id: 'pipe', definitionId: 'pipe_straight_1x1', position: { x: 5, y: 1 }, rotation: 180 };
    const render = (entities: WorldEntity[]) => resolveBuildingEffectScene({ manifest: fixture, definitions, entities });
    const disconnected = render([entity]);
    expect(disconnected.effects).toHaveLength(4);
    expect(disconnected.effects.every((effect) => effect.resourceId.includes('pipeoff'))).toBe(true);
    const connected = render([entity, pipe]);
    expect(connected.effects.filter((effect) => effect.resourceId.includes('pipeon'))).toHaveLength(1);
    expect(render([entity, { ...pipe, rotation: 0 }]).effects.every((effect) => effect.resourceId.includes('pipeoff'))).toBe(true);
    const rotated = render([{ ...entity, rotation: 90 }]);
    expect(rotated.effects[0]!.x).toBeCloseTo(3.5);
    expect(rotated.effects[0]!.y).toBeCloseTo(5);
    expect(render([]).effects).toHaveLength(0);
  });

  it('按明确状态过滤环，重复绑定只绘制一次；模式切换保留对应变体', () => {
    const fixture = correctedFixture();
    const view = fixture.views['transmuter_1/top']!;
    const ring = view.rings.find((candidate) => candidate.statusKey === 1)!;
    view.rings.push(structuredClone(ring));
    const scene = resolveBuildingEffectScene({ manifest: fixture, definitions, entities: [entity], ringStatus: new Map([[entity.id, 1]]) });
    expect(scene.effects.filter((effect) => effect.ring)).toHaveLength(1);
    const changed = resolveBuildingEffectScene({ manifest: fixture, definitions,
      entities: [{ ...entity, definitionId: 'transmuter_1_liquidtrans' }], ringStatus: new Map([[entity.id, -1]]) });
    expect(changed.effects.filter((effect) => effect.ring)).toHaveLength(0);
    expect(changed.effects.every((effect) => effect.id.includes('liquidtrans__0'))).toBe(true);
  });

  it('动画使用逐帧时长，独立于建筑动画帧号', () => {
    const resource = structuredClone(Object.values(manifest.effects)[0]!);
    resource.frames = [0, 1, 2].map((index) => ({ ...resource.frames[0]!, durationMs: [25, 75, 100][index]! }));
    resource.playback.mode = 'loop';
    expect([0, 24, 25, 99, 100, 199, 200].map((time) => resolveEffectFrame(resource, time))).toEqual([0, 0, 1, 1, 2, 2, 0]);
  });

  it('发布高度字节与无损 WebP 逐字节一致，所有数值文件及颜色页存在', async () => {
    const fields = new Map<string, HeightField>();
    for (const view of Object.values(manifest.views)) for (const field of Object.values(view.fields)) fields.set(field.file, field);
    for (const resource of Object.values(manifest.effects)) {
      fields.set(resource.height.file, resource.height);
      for (const page of resource.pages) expect((await readFile(`public/3d-top-view/port-effects/${page.file}`)).length).toBeGreaterThan(0);
    }
    for (const field of fields.values()) {
      const delivered = gunzipSync(await readFile(`public/3d-top-view/port-effects/${field.file}`));
      const original = await sharp(`resources/building-port-effects/assets/${field.file.replace(/\.rgba\.bin$/, '')}`).ensureAlpha().raw().toBuffer();
      expect(delivered.equals(original), field.file).toBe(true);
      expect(delivered.length).toBe(field.width * field.height * 4);
    }
  });
});
