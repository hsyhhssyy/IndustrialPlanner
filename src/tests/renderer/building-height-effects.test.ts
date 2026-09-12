import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { createRegistryContract } from '@/registry';
import type { WorldEntity } from '@/domain/document/world-document';
import type { BuildingEffectsManifest, HeightField, SurfacePlacement } from '@/renderer/building-effects/types';
import { decodeHeight, fieldBounds, rasterizeHeightTile, HEIGHT_TILE_PIXELS, tileKeys } from '@/renderer/building-effects/height-field';
import {
  resolveBuildingEffectScene,
  resolveEffectFrame,
  selectRingEffectPlacements,
} from '@/renderer/building-effects/placements';
import { resolveBuildingEffectStatusKey } from '@/renderer/building-effects/status';

const manifest = JSON.parse(await readFile('public/3d-top-view/port-effects/manifest.json', 'utf8')) as BuildingEffectsManifest;
const registry = createRegistryContract();
const definitions = new Map(registry.entityDefinitions.map((definition) => [definition.id, definition]));
const entity: WorldEntity = { id: 'device', definitionId: 'transmuter_1_gastrans',
  position: { x: 0, y: 0 }, rotation: 0, config: {}, tags: [] };

// AI-REMOVED 2026-09-11:
// Reason: 旧镜像夹具与统一源→项目坐标发布契约冲突。
// Trigger: 端口源 Z 需要映射为项目 -y，yaw 需要由运行时正号组合；夹具额外反射 X 并强制 yaw=180 会掩盖真实 Registry 匹配。
// Evidence: 发布器现已统一转换 position/center/origin/像素行，Renderer 直接消费项目坐标。
// Replacement: 使用发布后的 manifest，并在冲突测试中显式篡改一个端口位置。
// Risk: Low；仅归档测试夹具。
// Human Review: Required
//
// Original code:
// /** 独立的“已修正交付”夹具；产品原件保持不变，不将此镜像当作接入规则。 */
// function correctedFixture() {
//   const fixture = structuredClone(manifest);
//   for (const ports of Object.values(fixture.views['transmuter_1/top']!.variants)) {
//     for (const port of ports) { port.position[0] *= -1; port.yaw = 180; }
//   }
//   return fixture;
// }

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

  it('按项目坐标契约匹配 Registry，不反转 Registry 或猜测环状态', () => {
    const scene = resolveBuildingEffectScene({ manifest, definitions, entities: [entity] });
    expect(scene.surfaces).toHaveLength(1);
    expect(scene.effects).toHaveLength(4);
    expect(scene.ringEffects).toHaveLength(7);
    expect(scene.issues).toHaveLength(0);
  });

  it.each([
    ['closed', 1],
    ['idle', 3],
    ['normal', 4],
    ['blocked', 5],
    ['no-power', 6],
    ['not-in-power-net', 7],
  ] as const)('将仿真状态 %s 映射到素材 statusKey %s', (status, statusKey) => {
    expect(resolveBuildingEffectStatusKey(status)).toBe(statusKey);
  });

  it('同一设备的多个环候选只查询一次状态并选择精确枚举', () => {
    const scene = resolveBuildingEffectScene({ manifest, definitions, entities: [entity] });
    let queryCount = 0;
    const rings = selectRingEffectPlacements(scene.ringEffects, () => {
      queryCount += 1;
      return 4;
    });

    expect(queryCount).toBe(1);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toMatchObject({
      entityId: entity.id,
      statusKey: 4,
      resourceId: 'v1.5/fx/P_fxfac_interactive_mixpool_green_2502',
    });
  });

  it.each([
    ['filling_pd_mc_1_liquid', 'fluid_input', 'in_e_2'],
    ['shaper_1_gas', 'gas_input', 'in_e_1'],
  ])('%s 使用新版管道端口特效', (definitionId, portGroupId, portId) => {
    const target: WorldEntity = { ...entity, id: definitionId, definitionId };
    const scene = resolveBuildingEffectScene({ manifest, definitions, entities: [target] });

    expect(scene.effects).toHaveLength(1);
    expect(scene.issues).toHaveLength(0);
    expect([...scene.portKeys.values()]).toEqual([`${definitionId}:${portGroupId}:${portId}`]);
  });

  it('输入锚点发生明确偏移时拒绝该端口绑定', () => {
    const fixture = structuredClone(manifest);
    fixture.views['transmuter_1/top']!.variants['gastrans__0']![0]!.position[0] += 0.125;
    const scene = resolveBuildingEffectScene({ manifest: fixture, definitions, entities: [entity] });
    expect(scene.effects).toHaveLength(3);
    expect(scene.issues).toContain('transmuter_1_gastrans/gastrans__0/input:0: source anchor or direction conflicts with Registry');
  });

  it('验证单端口 ON/OFF、反向邻居、实体旋转和移除', () => {
    // Registry 的 transmuter 输出朝东；直管默认 W→E，因此位置相同且 rotation=0 时由输入 W 反向相连。
    const pipe: WorldEntity = { ...entity, id: 'pipe', definitionId: 'pipe_straight_1x1', position: { x: 5, y: 1 }, rotation: 0 };
    const render = (entities: WorldEntity[]) => resolveBuildingEffectScene({ manifest, definitions, entities });
    const disconnected = render([entity]);
    expect(disconnected.effects).toHaveLength(4);
    expect(disconnected.effects.every((effect) => effect.resourceId.includes('pipeoff'))).toBe(true);
    const connected = render([entity, pipe]);
    expect(connected.effects.filter((effect) => effect.resourceId.includes('pipeon'))).toHaveLength(1);
    expect(render([entity, { ...pipe, rotation: 180 }]).effects.every((effect) => effect.resourceId.includes('pipeoff'))).toBe(true);
    const rotated = render([{ ...entity, rotation: 90 }]);
    expect(rotated.effects[0]!.x).toBeCloseTo(1.5);
    expect(rotated.effects[0]!.y).toBeCloseTo(0);
    expect(rotated.effects[0]!.rotation).toBeCloseTo(90);
    expect(render([]).effects).toHaveLength(0);
  });

  it('按明确状态过滤环，重复绑定只绘制一次；模式切换保留对应变体', () => {
    const fixture = structuredClone(manifest);
    const isolatedView = fixture.views['transmuter_1/top']!;
    const ring = isolatedView.rings.find((candidate) => candidate.statusKey === 1)!;
    isolatedView.rings.push(structuredClone(ring));
    const scene = resolveBuildingEffectScene({ manifest: fixture, definitions, entities: [entity], ringStatus: new Map([[entity.id, 1]]) });
    expect(scene.ringEffects).toHaveLength(7);
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

  it('发布高度字节按坐标契约逐行转换，所有数值文件及颜色页存在', async () => {
    const fields = new Map<string, { field: HeightField; reflected: boolean }>();
    for (const view of Object.values(manifest.views)) for (const field of Object.values(view.fields)) {
      fields.set(field.file, { field, reflected: view.coordinateSpace === 'project-reflected-source' });
    }
    for (const resource of Object.values(manifest.effects)) {
      fields.set(resource.height.file, { field: resource.height, reflected: resource.coordinateSpace === 'project-reflected-source' });
      for (const page of resource.pages) expect((await readFile(`public/3d-top-view/port-effects/${page.file}`)).length).toBeGreaterThan(0);
    }
    for (const { field, reflected } of fields.values()) {
      const delivered = gunzipSync(await readFile(`public/3d-top-view/port-effects/${field.file}`));
      const original = await sharp(`resources/building-port-effects/assets/${field.file.replace(/\.rgba\.bin$/, '')}`).ensureAlpha().raw().toBuffer();
      const expected = Buffer.alloc(original.length);
      const rowBytes = field.width * 4;
      for (let row = 0; row < field.height; row++) {
        const sourceRow = reflected ? field.height - 1 - row : row;
        original.copy(expected, row * rowBytes, sourceRow * rowBytes, (sourceRow + 1) * rowBytes);
      }
      expect(delivered.equals(expected), field.file).toBe(true);
      expect(delivered.length).toBe(field.width * field.height * 4);
    }
  });

  it('发布特效页逐帧保持 RGBA，仅反射像素行且不改变帧索引与时长', async () => {
    const resourceId = 'v1.5/fx/P_interactive_large_pipeoff_out_01';
    const resource = manifest.effects[resourceId]!;
    const reflected = resource.coordinateSpace === 'project-reflected-source';
    const sourceEffect = JSON.parse(await readFile('resources/building-port-effects/assets/effects/P_interactive_large_pipeoff_out_01/effect.json', 'utf8')) as {
      frames: { page: number; x: number; y: number; width: number; height: number; durationMs: number }[];
      spritesheet: string;
    };
    const sourceSheet = JSON.parse(await readFile('resources/building-port-effects/assets/effects/P_interactive_large_pipeoff_out_01/spritesheet.json', 'utf8')) as {
      pages: { width: number; height: number }[];
    };
    expect(resource.frames.map(({ page, x, width, height, durationMs }, index) => ({
      page, x, width, height, durationMs,
      sourceY: sourceEffect.frames[index]!.y,
      publishedY: sourceSheet.pages[page]!.height - sourceEffect.frames[index]!.y - height,
    }))).toEqual(sourceEffect.frames.map(({ page, x, width, height, durationMs, y }) => ({
      page, x, width, height, durationMs,
      sourceY: y,
      publishedY: sourceSheet.pages[page]!.height - y - height,
    })));
    for (const [pageIndex, page] of resource.pages.entries()) {
      const source = await sharp(`resources/building-port-effects/assets/${page.file}`).ensureAlpha().raw().toBuffer();
      const delivered = await sharp(`public/3d-top-view/port-effects/${page.file}`).ensureAlpha().raw().toBuffer();
      const pageFrames = resource.frames.filter((frame) => frame.page === pageIndex);
      let mismatches = 0;
      for (const frame of pageFrames) {
        const sourceY = reflected ? page.height - frame.y - frame.height : frame.y;
        for (let row = 0; row < frame.height; row++) {
          const sourceRow = reflected ? sourceY + frame.height - 1 - row : frame.y + row;
          const deliveredRow = frame.y + row;
          const sourceOffset = (sourceRow * page.width + frame.x) * 4;
          const deliveredOffset = (deliveredRow * page.width + frame.x) * 4;
          for (let pixel = 0; pixel < frame.width; pixel++) {
            const sourcePixel = sourceOffset + pixel * 4;
            const deliveredPixel = deliveredOffset + pixel * 4;
            if (delivered[deliveredPixel + 3] !== source[sourcePixel + 3]
              || (source[sourcePixel + 3] !== 0
                && [0, 1, 2].some((channel) => delivered[deliveredPixel + channel] !== source[sourcePixel + channel]))) mismatches++;
          }
        }
      }
      expect(mismatches, page.file).toBe(0);
    }
  });
});
