import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
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
  resolveEffectPlaybackTimeMs,
  selectRingEffectPlacements,
} from '@/renderer/building-effects/placements';
import { resolveBuildingEffectStatusKey } from '@/renderer/building-effects/status';
// @ts-expect-error Node 发布配置直接复用，数值采样期望由测试独立计算。
import { BUILDING_ASSET_PUBLISH_RESOLUTIONS } from '../../scripts/building-asset-publish-config.mjs';

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
  ] as const)('%s 的每个箭头动画由相邻管道流体状态驱动', (definitionId, pipePositions) => {
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
    expect(new Set(targetEffects.map((effect) => effect.animationFluidEntityId))).toEqual(
      new Set(pipePositions.map(({ id }) => id)),
    );

    const disconnected = resolveBuildingEffectScene({ manifest, definitions, entities: [target] });
    expect(disconnected.effects.every((effect) => effect.animationFluidEntityId === null)).toBe(true);
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
    expect(resolveEffectFrame(resource, null)).toBe(2);
  });

  it('暗管箭头只在相邻管道存在可见流体时使用该运输组时钟', () => {
    const pipeState = {
      kind: 'pipe' as const,
      shape: 'straight' as const,
      rotation: 0,
      start: 0,
      support: false,
      marker: false,
      fluidItemId: null as string | null,
      pipeFlow: { seconds: 2.5, flowing: false },
    };
    const materials = {
      entities: new Map([['pipe', pipeState]]),
      beltSeconds: 0,
      animationEnabled: true,
    };

    expect(resolveEffectPlaybackTimeMs({}, materials, 1234)).toBe(1234);
    expect(resolveEffectPlaybackTimeMs({ animationFluidEntityId: null }, materials, 1234)).toBeNull();
    expect(resolveEffectPlaybackTimeMs({ animationFluidEntityId: 'pipe' }, materials, 1234)).toBeNull();
    pipeState.fluidItemId = 'item_liquid_water';
    expect(resolveEffectPlaybackTimeMs({ animationFluidEntityId: 'pipe' }, materials, 1234)).toBe(2500);
  });

  it('发布高度字节按坐标契约逐行转换，所有数值文件及颜色页存在', async () => {
    interface SourceSiteReference {
      readonly root: string;
    }
    interface PublishReceiptProduct {
      readonly path: string;
      readonly sha256: string;
      readonly retained?: boolean;
    }
    const collection = JSON.parse(await readFile('resources/building-top-view-v15.json', 'utf8')) as {
      readonly sourceSite: SourceSiteReference;
      readonly entries: readonly {
        readonly sourceMetadata: { readonly sourceSite: SourceSiteReference };
      }[];
    };
    const logisticsManifest = JSON.parse(
      await readFile('public/3d-top-view/logistics/baked/manifest.json', 'utf8'),
    ) as { readonly sourceSite: SourceSiteReference };
    const resolution = BUILDING_ASSET_PUBLISH_RESOLUTIONS[0];
    const declaredSourceSites = [...new Map([
      collection.sourceSite,
      ...collection.entries.map((entry) => entry.sourceMetadata.sourceSite),
      logisticsManifest.sourceSite,
    ].map((sourceSite) => [sourceSite.root, sourceSite])).values()];
    const publications = (await Promise.all(declaredSourceSites.map(async (sourceSite) => {
      const importDirectory = path.join(sourceSite.root, '_import');
      const receiptFiles = (await readdir(importDirectory))
        .filter((fileName) => /^publish-receipt(?:\.entities-[a-f\d]+)?\.json$/.test(fileName));
      return Promise.all(receiptFiles.map(async (receiptFile) => ({
        sourceSite,
        products: (JSON.parse(await readFile(
          path.join(importDirectory, receiptFile),
          'utf8',
        )) as { readonly products: readonly PublishReceiptProduct[] }).products,
      })));
    }))).flat();
    const fields = new Map<string, { field: HeightField; reflected: boolean }>();
    for (const view of Object.values(manifest.views)) for (const field of Object.values(view.fields)) {
      fields.set(field.file, { field, reflected: view.coordinateSpace === 'project-reflected-source' });
    }
    for (const resource of Object.values(manifest.effects)) {
      fields.set(resource.height.file, { field: resource.height, reflected: resource.coordinateSpace === 'project-reflected-source' });
      for (const page of resource.pages) expect((await readFile(`public/3d-top-view/port-effects/${page.file}`)).length).toBeGreaterThan(0);
    }
    for (const { field, reflected } of fields.values()) {
      const productPath = `public/3d-top-view/port-effects/${field.file}`;
      const matchingPublications = publications.flatMap(({ sourceSite, products }) =>
        products
          .filter((product) => product.path === productPath)
          .map((product) => ({ sourceSite, product })),
      );
      const authoredPublications = matchingPublications.filter(({ product }) => product.retained !== true);
      const compressed = await readFile(productPath);
      const publishedSha256 = createHash('sha256').update(compressed).digest('hex');
      if (authoredPublications.length === 0) {
        expect(matchingPublications.length, `${field.file} has no declared publication receipt`)
          .toBeGreaterThan(0);
        expect(matchingPublications.every(({ product }) =>
          product.retained === true && product.sha256 === publishedSha256), field.file).toBe(true);
        expect(gunzipSync(compressed).length).toBe(field.width * field.height * 4);
        continue;
      }
      expect(authoredPublications, `${field.file} must have exactly one authoring source`).toHaveLength(1);
      const authoredPublication = authoredPublications[0]!;
      expect(publishedSha256, field.file).toBe(authoredPublication.product.sha256);
      const delivered = gunzipSync(compressed);
      const { data: original, info } = await sharp(path.join(
        authoredPublication.sourceSite.root,
        field.file.replace(/\.rgba\.bin$/, ''),
      ))
        .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const expected = Buffer.alloc(field.width * field.height * 4);
      const rowBytes = field.width * 4;
      for (let row = 0; row < field.height; row++) {
        const sampledRow = Math.floor((row + 0.5) / resolution);
        const sourceRow = reflected ? info.height - 1 - sampledRow : sampledRow;
        for (let pixel = 0; pixel < field.width; pixel++) {
          const sourcePixel = Math.floor((pixel + 0.5) / resolution);
          if (sourcePixel >= info.width || sourceRow < 0 || sourceRow >= info.height) continue;
          const offset = (sourceRow * info.width + sourcePixel) * 4;
          original.copy(expected, row * rowBytes + pixel * 4, offset, offset + 4);
        }
      }
      expect(delivered.equals(expected), field.file).toBe(true);
      expect(delivered.length).toBe(field.width * field.height * 4);
    }
  });

  it.each(Object.keys(manifest.effects))('发布特效 %s 逐帧补边缩放并重新排布，保持帧序、时长与采样位置', async (resourceId) => {
    const collection = JSON.parse(await readFile('resources/building-top-view-v15.json', 'utf8'));
    const resolution = BUILDING_ASSET_PUBLISH_RESOLUTIONS[0];
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
    const reflected = resource.coordinateSpace === 'project-reflected-source';
    const sourceDirectory = path.join(collection.sourceSite.root, path.dirname(resource.height.file));
    const sourceEffect = JSON.parse(await readFile(path.join(sourceDirectory, 'effect.json'), 'utf8')) as {
      frames: { page: number; x: number; y: number; width: number; height: number; durationMs: number }[];
      spritesheet: string;
    };
    const sourceSheet = JSON.parse(await readFile(path.join(sourceDirectory, sourceEffect.spritesheet), 'utf8')) as {
      pages: { image: string; width: number; height: number }[];
    };
    expect(resource.frames.map(({ width, height, durationMs }) => ({
      width, height, durationMs,
    }))).toEqual(sourceEffect.frames.map(({ width, height, durationMs }) => ({
      width: Math.ceil(width * resolution), height: Math.ceil(height * resolution), durationMs,
    })));
    for (const [pageIndex, page] of resource.pages.entries()) {
      const delivered = await sharp(`public/3d-top-view/port-effects/${page.file}`).ensureAlpha().raw().toBuffer();
      const pageFrames = resource.frames.filter((frame) => frame.page === pageIndex);
      let mismatches = 0;
      for (const frame of pageFrames) {
        const original = sourceEffect.frames[resource.frames.indexOf(frame)]!;
        const sheetPage = sourceSheet.pages[original.page]!;
        let extract = sharp(path.join(sourceDirectory, sheetPage.image))
          .extract({ left: original.x, top: original.y, width: original.width, height: original.height });
        if (reflected) extract = extract.flip();
        const pixels = await extract.ensureAlpha().raw().toBuffer();
        // AI-REMOVED 2026-09-14:
        // Reason: 测试与发布器复用了错误的 Sharp 操作顺序，掩盖了真实行宽错误。
        // Trigger: 修复奇数尺寸补边后产生的斜纹，必须独立验证像素位置。
        // Evidence: 同一流水线中 extend 在 resize 后执行；旧期望同样输出多余列。
        // Replacement: 下方在 CPU 上独立补透明边，只调用 Sharp 执行缩放。
        // Risk: Low；保持原有帧序、时长、采样位置断言目标。
        // Human Review: Required
        //
        // Original code:
        // const source = await sharp(pixels, { raw: { width: original.width, height: original.height, channels: 4 } })
        //   .extend({ left: 0, top: 0, right: frame.width / resolution - original.width,
        //     bottom: frame.height / resolution - original.height, background: { r: 0, g: 0, b: 0, alpha: 0 } })
        //   .resize(frame.width, frame.height, { kernel: 'lanczos3' }).raw().toBuffer();
        const paddedWidth = frame.width / resolution, paddedHeight = frame.height / resolution;
        const padded = Buffer.alloc(paddedWidth * paddedHeight * 4);
        for (let row = 0; row < original.height; row++) {
          pixels.copy(padded, row * paddedWidth * 4, row * original.width * 4, (row + 1) * original.width * 4);
        }
        const resized = await sharp(padded, { raw: { width: paddedWidth, height: paddedHeight, channels: 4 } })
          .resize(frame.width, frame.height, { kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true });
        expect(resized.info).toMatchObject({ width: frame.width, height: frame.height, channels: 4 });
        expect(resized.data.length).toBe(frame.width * frame.height * 4);
        const source = resized.data;
        for (let row = 0; row < frame.height; row++) {
          const sourceRow = row;
          const deliveredRow = frame.y + row;
          const sourceOffset = sourceRow * frame.width * 4;
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
