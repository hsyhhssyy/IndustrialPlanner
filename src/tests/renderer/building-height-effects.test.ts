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
  // AI-REMOVED 2026-09-25:
  // Reason: 端口特效统一使用场景时钟，流体门控函数已移除。
  // Trigger: 用户明确要求 on/off 动画始终播放。
  // Evidence: 原函数对未连接的 off 返回 null，无法推进帧。
  // Replacement: 下方 on/off 循环播放断言。
  // Risk: Low。
  // Human Review: Required
  //
  // Original code:
  // resolveEffectPlaybackTimeMs,
  selectRingEffectPlacements,
} from '@/renderer/building-effects/placements';
import { resolveBuildingEffectStatusKey } from '@/renderer/building-effects/status';
// AI-REMOVED 2026-09-19:
// Reason: 正式仓库不再保存网站展开原件和发布收据，运行时测试不能依赖本地来源目录。
// Trigger: 用户要求网站素材只存在于 .temp/.trash 导入批次。
// Evidence: import-building-assets validate 已在批次内核对原件哈希、尺寸和数值编码。
// Replacement: 下方直接验证全部已发布数值文件、颜色页和图集边界。
// Risk: 普通 Vitest 不再逐像素比较网站原图；发布算法的独立夹具测试继续覆盖转换。
// Human Review: Required
//
// Original code:
// import { readFile, readdir } from 'node:fs/promises';
// import { createHash } from 'node:crypto';
// import path from 'node:path';
// import { BUILDING_ASSET_PUBLISH_RESOLUTIONS } from '../../scripts/building-asset-publish-config.mjs';

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
  ])('%s 在新版素材未交付对应模式时不借用其他管道特效', (definitionId) => {
    const target: WorldEntity = { ...entity, id: definitionId, definitionId };
    const scene = resolveBuildingEffectScene({ manifest, definitions, entities: [target] });

    expect(scene.effects).toHaveLength(0);
    expect(scene.issues).toHaveLength(0);
    expect(scene.portKeys.size).toBe(0);
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

  it.each([
    ['udpipe_loader_1', [{ id: 'pipe-1', x: -1, y: 1 }]],
    ['udpipe_unloader_1', [{ id: 'pipe-1', x: 3, y: 1 }]],
    ['udpipe_loader_2', [{ id: 'pipe-1', x: -1, y: 1 }, { id: 'pipe-2', x: -1, y: 3 }]],
    ['udpipe_unloader_2', [{ id: 'pipe-1', x: 3, y: 3 }, { id: 'pipe-2', x: 3, y: 1 }]],
  // AI-REMOVED 2026-09-25:
  // Reason: 旧测试标题描述的流体驱动行为与新的持续播放要求冲突。
  // Trigger: 用户明确要求未接管道的 off 和已接管道的 on 始终播放。
  // Evidence: 端口特效资源都声明为 loop。
  // Replacement: 下方 on/off 资源与场景时钟推进断言。
  // Risk: Low。
  // Human Review: Required
  //
  // Original code:
  // ] as const)('%s 的每个箭头动画由相邻管道流体状态驱动', (definitionId, pipePositions) => {
  ] as const)('%s 的每个端口按连接状态选择 on/off 并持续播放', (definitionId, pipePositions) => {
    const target: WorldEntity = { ...entity, id: 'dark-pipe', definitionId };
    const pipes = pipePositions.map(({ id, x, y }) => ({
      ...entity,
      id,
      definitionId: 'pipe_straight_1x1',
      position: { x, y },
      rotation: 0 as const,
    }));
    const connected = resolveBuildingEffectScene({ manifest, definitions, entities: [target, ...pipes] });
    const targetEffects = connected.effects.filter((effect) => effect.id.startsWith(`${target.id}:`));

    expect(connected.issues).toEqual([]);
    expect(targetEffects).toHaveLength(pipePositions.length);
    // AI-REMOVED 2026-09-25:
    // Reason: 特效不再存储相邻管道 ID，播放不依赖管道流体。
    // Trigger: 用户要求 on/off 始终播放。
    // Evidence: EffectPlacement 已移除 animationFluidEntityId。
    // Replacement: 下方分别验证 on/off 资源及帧推进。
    // Risk: Low。
    // Human Review: Required
    //
    // Original code:
    // expect(new Set(targetEffects.map((effect) => effect.animationFluidEntityId))).toEqual(
    //   new Set(pipePositions.map(({ id }) => id)),
    // );
    for (const effect of targetEffects) {
      expect(effect.resourceId).toContain('pipeon');
      const resource = manifest.effects[effect.resourceId]!;
      expect(resource.playback.mode).toBe('loop');
      expect(resolveEffectFrame(resource, 100)).toBeGreaterThan(resolveEffectFrame(resource, 0));
    }

    const disconnected = resolveBuildingEffectScene({ manifest, definitions, entities: [target] });
    // AI-REMOVED 2026-09-25:
    // Reason: 未连接端口也应持续播放 off，不能保留静态帧标志。
    // Trigger: 用户明确要求 off 动画始终播放。
    // Evidence: 断开端口原 animationFluidEntityId=null 被播放函数解释为静态帧。
    // Replacement: 下方验证 off 资源为 loop 并按时钟前进。
    // Risk: Low。
    // Human Review: Required
    //
    // Original code:
    // expect(disconnected.effects.every((effect) => effect.animationFluidEntityId === null)).toBe(true);
    expect(disconnected.effects).toHaveLength(pipePositions.length);
    for (const effect of disconnected.effects) {
      expect(effect.resourceId).toContain('pipeoff');
      const resource = manifest.effects[effect.resourceId]!;
      expect(resource.playback.mode).toBe('loop');
      expect(resolveEffectFrame(resource, 100)).toBeGreaterThan(resolveEffectFrame(resource, 0));
    }
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
    expect(changed.effects).toHaveLength(0);
  });

  it('动画使用逐帧时长，独立于建筑动画帧号', () => {
    const resource = structuredClone(Object.values(manifest.effects)[0]!);
    resource.frames = [0, 1, 2].map((index) => ({ ...resource.frames[0]!, durationMs: [25, 75, 100][index]! }));
    resource.playback.mode = 'loop';
    resource.playback.staticFrame = 2;
    expect([0, 24, 25, 99, 100, 199, 200].map((time) => resolveEffectFrame(resource, time))).toEqual([0, 0, 1, 1, 2, 2, 0]);
    // AI-REMOVED 2026-09-25:
    // Reason: 端口特效不再支持 null 时钟冻结到 staticFrame。
    // Trigger: 用户明确要求 on/off 动画始终播放。
    // Evidence: 唯一运行时调用方只传入 nowMs。
    // Replacement: 上方按时间推进和循环的断言。
    // Risk: Low。
    // Human Review: Required
    //
    // Original code:
    // expect(resolveEffectFrame(resource, null)).toBe(2);
  });

  // AI-REMOVED 2026-09-25:
  // Reason: 原测试固定了“断开或空管冻结端口特效”的错误行为。
  // Trigger: 用户明确要求 on/off 两种端口特效始终播放。
  // Evidence: 上方测试已验证两种资源按场景时钟循环推进；流体门控函数已移除。
  // Replacement: 上方四种暗管型号的 on/off 播放测试。
  // Risk: Low；不再测试按流体运输组相位同步。
  // Human Review: Required
  //
  // Original code:
  // it('暗管箭头只在相邻管道存在可见流体时使用该运输组时钟', () => {
  //   const pipeState = {
  //     kind: 'pipe' as const,
  //     shape: 'straight' as const,
  //     rotation: 0,
  //     start: 0,
  //     support: false,
  //     marker: false,
  //     fluidItemId: null as string | null,
  //     pipeFlow: { seconds: 2.5, flowing: false },
  //   };
  //   const materials = {
  //     entities: new Map([['pipe', pipeState]]),
  //     beltSeconds: 0,
  //     animationEnabled: true,
  //   };
  //
  //   expect(resolveEffectPlaybackTimeMs({}, materials, 1234)).toBe(1234);
  //   expect(resolveEffectPlaybackTimeMs({ animationFluidEntityId: null }, materials, 1234)).toBeNull();
  //   expect(resolveEffectPlaybackTimeMs({ animationFluidEntityId: 'pipe' }, materials, 1234)).toBeNull();
  //   pipeState.fluidItemId = 'item_liquid_water';
  //   expect(resolveEffectPlaybackTimeMs({ animationFluidEntityId: 'pipe' }, materials, 1234)).toBe(2500);
  // });

  it('所有已发布高度数值文件和特效颜色页完整且编码合法', async () => {
    const fields = new Map<string, { field: HeightField; reflected: boolean }>();
    for (const view of Object.values(manifest.views)) for (const field of Object.values(view.fields)) {
      fields.set(field.file, { field, reflected: view.coordinateSpace === 'project-reflected-source' });
    }
    for (const resource of Object.values(manifest.effects)) {
      fields.set(resource.height.file, { field: resource.height, reflected: resource.coordinateSpace === 'project-reflected-source' });
      for (const page of resource.pages) expect((await readFile(`public/3d-top-view/port-effects/${page.file}`)).length).toBeGreaterThan(0);
    }
    for (const { field } of fields.values()) {
      const productPath = `public/3d-top-view/port-effects/${field.file}`;
      const compressed = await readFile(productPath);
      const delivered = gunzipSync(compressed);
      expect(delivered.length, field.file).toBe(field.width * field.height * 4);
      let invalidBluePixels = 0;
      let invalidAlphaPixels = 0;
      for (let offset = 0; offset < delivered.length; offset += 4) {
        if (delivered[offset + 2] !== 0) invalidBluePixels += 1;
        if (delivered[offset + 3] !== 0 && delivered[offset + 3] !== 255) invalidAlphaPixels += 1;
      }
      expect(invalidBluePixels, field.file).toBe(0);
      expect(invalidAlphaPixels, field.file).toBe(0);
    }
  });

  it.each(Object.keys(manifest.effects))('发布特效 %s 的分页、帧边界和时长自洽', async (resourceId) => {
    // AI-REMOVED 2026-09-14:
    // Reason: 单个资源覆盖不足；奇数高度和其他端口、状态环同样需要验证。
    // Trigger: 共享缩放函数导致多组烘焙素材错位。
    // Evidence: 当前 manifest 中 8 组资源需要透明补边。
    // Replacement: 上方 it.each 遍历所有已发布特效。
    // Risk: Low；扩大原有逐帧验证范围。
    // Human Review: Required
    //
    // Original code:
    // const resourceId = 'v1.5/fx/P_interactive_large_pipeoff_out_01';
    const resource = manifest.effects[resourceId]!;
    for (const [pageIndex, page] of resource.pages.entries()) {
      const metadata = await sharp(`public/3d-top-view/port-effects/${page.file}`).metadata();
      expect(metadata).toMatchObject({ width: page.width, height: page.height, format: 'webp' });
      const pageFrames = resource.frames.filter((frame) => frame.page === pageIndex);
      for (const frame of pageFrames) {
        expect(frame.durationMs).toBeGreaterThan(0);
        expect(frame.x).toBeGreaterThanOrEqual(0);
        expect(frame.y).toBeGreaterThanOrEqual(0);
        expect(frame.width).toBeGreaterThan(0);
        expect(frame.height).toBeGreaterThan(0);
        expect(frame.x + frame.width).toBeLessThanOrEqual(page.width);
        expect(frame.y + frame.height).toBeLessThanOrEqual(page.height);
      }
    }
  });
});
