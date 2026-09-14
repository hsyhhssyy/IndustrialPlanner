import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { publishedImageSize, resizeAssetRgba } from './building-asset-image.mjs';

const TILE = 128;
const PADDING = 2;

/** 编码 sRGB 数值空间的 straight-alpha source-over，与 contract2 的离线规范一致。 */
export function compositeLogisticsLayers(layers) {
  const output = Buffer.alloc(TILE * TILE * 4);
  for (let i = 0; i < output.length; i += 4) {
    let a = 0;
    const rgb = [0, 0, 0];
    for (const { pixels, tint = [1, 1, 1] } of layers) {
      const sa = pixels[i + 3] / 255;
      for (let channel = 0; channel < 3; channel++) {
        rgb[channel] = pixels[i + channel] / 255 * tint[channel] * sa + rgb[channel] * (1 - sa);
      }
      a = sa + a * (1 - sa);
    }
    for (let channel = 0; channel < 3; channel++) output[i + channel] = a ? Math.round(rgb[channel] / a * 255) : 0;
    output[i + 3] = Math.round(a * 255);
  }
  return output;
}

/** 固定小图集及挤出边缘；运行时仅创建子纹理，不合成画布或 RenderTexture。 */
export async function publishAtlas(directory, name, entries, manifest, resolution) {
  const tileSize = publishedImageSize(TILE, TILE, resolution).width;
  const STRIDE = tileSize + PADDING * 2;
  const columns = Math.min(4, entries.length);
  const rows = Math.ceil(entries.length / columns);
  const width = columns * STRIDE;
  const height = rows * STRIDE;
  const pixels = Buffer.alloc(width * height * 4);
  for (const [index, [key, sourceTile]] of entries.entries()) {
    const { data: tile } = await resizeAssetRgba(sourceTile, TILE, TILE, resolution);
    const left = index % columns * STRIDE;
    const top = Math.floor(index / columns) * STRIDE;
    for (let y = 0; y < STRIDE; y++) {
      for (let x = 0; x < STRIDE; x++) {
        const sx = Math.min(tileSize - 1, Math.max(0, x - PADDING));
        const sy = Math.min(tileSize - 1, Math.max(0, y - PADDING));
        tile.copy(pixels, ((top + y) * width + left + x) * 4, (sy * tileSize + sx) * 4, (sy * tileSize + sx) * 4 + 4);
      }
    }
    manifest.frames[key] = { page: name, rect: [left + PADDING, top + PADDING, tileSize, tileSize] };
  }
  const file = `${name}.webp`;
  await sharp(pixels, { raw: { width, height, channels: 4 } })
    .webp({ lossless: true }).toFile(path.join(directory, file));
  manifest.pages[name] = { file, width, height };
}


// AI-REMOVED 2026-09-14:
// Reason: 历史 ZIP/逐颜色图集发布入口不再被项目消费，防止重建覆盖烘焙物流。
// Trigger: 用户确认共享烘焙纹理接入。
// Evidence: 所有调用已迁移到 publish-logistics-baked.mjs。
// Replacement: publish-logistics-baked.mjs；本文件仅保留通用 RGBA 合成与图集打包。
// Risk: Low; Human Review: Required
// Original code:
// import { createHash } from 'node:crypto';
// // AI-REMOVED 2026-09-13: copyFile 已由按纹理语义缩放后写入替代；Trigger: 同批多规格发布；Evidence: 本文件无复制调用；Replacement: publishLogisticsMaterials；Risk: Low；Human Review: Required。
// // Original code: import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
// import { mkdir, readFile, writeFile } from 'node:fs/promises';
// import { gzipSync } from 'node:zlib';
// import path from 'node:path';
// import { fileURLToPath } from 'node:url';
// import sharp from 'sharp';
// import { tsImport } from 'tsx/esm/api';
// import { publishedImageSize, resizeAssetRgba } from './building-asset-image.mjs';
//
// const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// const importOptions = { parentURL: import.meta.url, tsconfig: path.join(projectRoot, 'tsconfig.app.json') };
// const protocol = await tsImport('../shared/logistics-material.ts', importOptions);
// const TILE = 128;
// const PADDING = 2;
//
// /**
//  * 2026-09-10 用户依据装配截图订正：contract2 直段支架与管轴平行，须绕中心转 90°。
//  * 在导入边界同时规范化三层；静态合成和动态发布共用，源包及其 SHA-256 保持可追溯。
//  */
// const SOURCE_COLOR_LAYER_ROTATIONS = new Map([
//   ['pipe.straight.support-back', 90],
//   ['pipe.straight.support-middle', 90],
//   ['pipe.straight.support-front', 90],
// ]);
//
// /** 编码 sRGB 数值空间的 straight-alpha source-over，与 contract2 的离线规范一致。 */
// export function compositeLogisticsLayers(layers) {
//   const output = Buffer.alloc(TILE * TILE * 4);
//   for (let i = 0; i < output.length; i += 4) {
//     let a = 0;
//     const rgb = [0, 0, 0];
//     for (const { pixels, tint = [1, 1, 1] } of layers) {
//       const sa = pixels[i + 3] / 255;
//       for (let channel = 0; channel < 3; channel++) {
//         rgb[channel] = pixels[i + channel] / 255 * tint[channel] * sa + rgb[channel] * (1 - sa);
//       }
//       a = sa + a * (1 - sa);
//     }
//     for (let channel = 0; channel < 3; channel++) output[i + channel] = a ? Math.round(rgb[channel] / a * 255) : 0;
//     output[i + 3] = Math.round(a * 255);
//   }
//   return output;
// }
//
// async function readCollection(sourceDirectory, mode, websiteCollection = null) {
//   const directory = websiteCollection ? sourceDirectory : path.join(sourceDirectory, mode);
//   const collection = websiteCollection ?? JSON.parse(await readFile(path.join(directory, 'collection.json'), 'utf8'));
//   if (collection.materialContractVersion !== 2 || (!websiteCollection && collection.mode !== mode)
//     || (!websiteCollection && mode === 'dynamic' && collection.requiresBaseContract !== 2)) throw new Error(`Invalid ${mode} collection`);
//   const resources = new Map();
//   const manifests = new Map();
//   for (const entry of websiteCollection ? collection.deliveries : collection.packages) {
//     const manifestPath = path.join(directory, websiteCollection ? entry[mode === 'static' ? 'base' : 'extension'] : entry.manifest);
//     if (!path.resolve(manifestPath).startsWith(`${path.resolve(sourceDirectory)}${path.sep}`)) throw new Error(`Material manifest escapes source: ${entry.id}`);
//     const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
//     if (manifest.materialContractVersion !== 2) throw new Error(`Invalid material version: ${entry.id}`);
//     manifests.set(entry.id, manifest);
//     for (const [key, resource] of Object.entries(manifest.resources)) {
//       const file = path.join(path.dirname(manifestPath), resource.file);
//       if (!path.resolve(file).startsWith(`${path.resolve(sourceDirectory)}${path.sep}`)) throw new Error(`Material resource escapes source: ${key}`);
//       const bytes = await readFile(file);
//       const digest = createHash('sha256').update(bytes).digest('hex');
//       const metadata = await sharp(bytes).metadata();
//       if (digest !== resource.sha256 || metadata.width !== resource.width || metadata.height !== resource.height) {
//         throw new Error(`Material integrity mismatch: ${key}`);
//       }
//       if (key !== `${mode}/${resource.semantic}`) throw new Error(`Invalid material namespace: ${key}`);
//       const previous = resources.get(key);
//       if (previous && ['sha256', 'width', 'height', 'colorSpace', 'alpha', 'filter', 'wrap']
//         .some((field) => previous[field] !== resource[field])) throw new Error(`Conflicting resource: ${key}`);
//       resources.set(key, { ...resource, path: file });
//     }
//   }
//   const specificationPath = websiteCollection
//     ? path.join(path.dirname(path.join(directory, collection.deliveries[0][mode === 'static' ? 'base' : 'extension'])), 'material-computation.json')
//     : path.join(directory, collection.materialSpecification);
//   const specification = JSON.parse(await readFile(specificationPath, 'utf8'));
//   return { resources, manifests, specification };
// }
//
// /** 固定小图集及挤出边缘；运行时仅创建子纹理，不合成画布或 RenderTexture。 */
// export async function publishAtlas(directory, name, entries, manifest, resolution) {
//   const tileSize = publishedImageSize(TILE, TILE, resolution).width;
//   const STRIDE = tileSize + PADDING * 2;
//   const columns = Math.min(4, entries.length);
//   const rows = Math.ceil(entries.length / columns);
//   const width = columns * STRIDE;
//   const height = rows * STRIDE;
//   const pixels = Buffer.alloc(width * height * 4);
//   for (const [index, [key, sourceTile]] of entries.entries()) {
//     const { data: tile } = await resizeAssetRgba(sourceTile, TILE, TILE, resolution);
//     const left = index % columns * STRIDE;
//     const top = Math.floor(index / columns) * STRIDE;
//     for (let y = 0; y < STRIDE; y++) {
//       for (let x = 0; x < STRIDE; x++) {
//         const sx = Math.min(tileSize - 1, Math.max(0, x - PADDING));
//         const sy = Math.min(tileSize - 1, Math.max(0, y - PADDING));
//         tile.copy(pixels, ((top + y) * width + left + x) * 4, (sy * tileSize + sx) * 4, (sy * tileSize + sx) * 4 + 4);
//       }
//     }
//     manifest.frames[key] = { page: name, rect: [left + PADDING, top + PADDING, tileSize, tileSize] };
//   }
//   const file = `${name}.webp`;
//   await sharp(pixels, { raw: { width, height, channels: 4 } })
//     .webp({ lossless: true }).toFile(path.join(directory, file));
//   manifest.pages[name] = { file, width, height };
// }
//
// export async function publishLogisticsMaterials({
//   sourceDirectory = path.join(projectRoot, 'resources/logistics-materials/contract2'),
//   outputDirectory = path.join(projectRoot, 'public/3d-top-view/logistics'),
//   spriteDirectory = path.join(projectRoot, 'public/3d-top-view/sprites'),
//   maskDirectory = path.join(projectRoot, 'public/3d-top-view/sprite-masks'),
//   registry,
//   websiteCollection = null,
//   resolution = 1,
// } = {}) {
//   registry ??= (await tsImport('../registry/index.ts', importOptions)).createRegistryContract();
//   const sourceStatic = await readCollection(sourceDirectory, 'static', websiteCollection);
//   const sourceDynamic = await readCollection(sourceDirectory, 'dynamic', websiteCollection);
//   const staticDirectory = path.join(outputDirectory, 'static');
//   const dynamicDirectory = path.join(outputDirectory, '../animations/logistics-contract2');
//   for (const directory of [staticDirectory, dynamicDirectory, spriteDirectory, maskDirectory]) await mkdir(directory, { recursive: true });
//   publishedImageSize(TILE, TILE, resolution);
//   const manifest = { schemaVersion: 1, materialContractVersion: 2, pixelsPerCell: TILE * resolution, pages: {}, frames: {} };
//   const decoded = new Map();
//   const normalizedColorImages = new Map();
//   for (const [key, resource] of sourceStatic.resources) {
//     if (resource.width === TILE && resource.height === TILE) {
//       const rotation = SOURCE_COLOR_LAYER_ROTATIONS.get(resource.semantic) ?? 0;
//       const image = sharp(resource.path).rotate(rotation).ensureAlpha();
//       decoded.set(key.slice('static/'.length), await image.clone().raw().toBuffer());
//       if (rotation !== 0) normalizedColorImages.set(key, await image.webp({ lossless: true }).toBuffer());
//     }
//   }
//   const get = (key) => {
//     const pixels = decoded.get(key);
//     if (!pixels) throw new Error(`Missing color layer: ${key}`);
//     return pixels;
//   };
//   const shapes = protocol.LOGISTICS_MATERIAL_SHAPES;
//   const beltEntries = shapes.map((shape) => [`belt/${shape}`, get(`conveyor.${shape}.static`)]);
//   beltEntries.push(['belt/straight-base', get('conveyor.straight.base')]);
//   await publishAtlas(staticDirectory, 'belt', beltEntries, manifest, resolution);
//   const colors = ['empty', ...new Set(['ffffff', ...registry.itemDefinitions
//     .filter((item) => item.tags.some((tag) => /^(gas_color|fluid_color|liquid_color):/.test(tag)))
//     .map((item) => protocol.resolveLogisticsFluidColor(item.tags))])].sort();
//   const defaultPipeImages = new Map();
//   for (const color of colors) {
//     const entries = [];
//     for (const shape of shapes) {
//       for (const support of shape === 'straight' ? [false, true] : [true]) {
//         for (const marker of [false, true]) {
//           const layers = [];
//           const push = (suffix) => layers.push({ pixels: get(`pipe.${shape}.${suffix}`) });
//           if (support) push('support-back');
//           if (color !== 'empty') {
//             const tint = [0, 2, 4].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255);
//             layers.push({ pixels: get(`pipe.${shape}.fluid-body`), tint });
//             push('fluid-specular');
//           }
//           if (support) push('support-middle');
//           push('shell');
//           if (marker) push('static-marker');
//           if (support) push('support-front');
//           const pixels = compositeLogisticsLayers(layers);
//           const state = { kind: 'pipe', shape, support, marker, color };
//           entries.push([protocol.logisticsStaticFrameKey(state), pixels]);
//           if (color === 'empty' && support && marker) defaultPipeImages.set(shape, pixels);
//         }
//       }
//     }
//     await publishAtlas(staticDirectory, `pipe-${color}`, entries, manifest, resolution);
//   }
//   await writeFile(path.join(staticDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
//
//   // 普通图片及导出预览继续走既有 spriteId；基准旋转仅在此处烘焙一次。
//   for (const definition of registry.entityDefinitions) {
//     const spec = protocol.resolveLogisticsMaterialSpec(definition.spriteId);
//     if (!spec) continue;
//     const pixels = spec.kind === 'belt' ? get(`conveyor.${spec.shape}.static`) : defaultPipeImages.get(spec.shape);
//     const rotated = await sharp(pixels, { raw: { width: TILE, height: TILE, channels: 4 } })
//       .rotate(spec.rotation).raw().toBuffer();
//     await sharp(rotated, { raw: { width: TILE, height: TILE, channels: 4 } })
//       .resize(TILE * resolution, TILE * resolution, { kernel: 'lanczos3' }).webp({ lossless: true })
//       .toFile(path.join(spriteDirectory, `${definition.spriteId}.webp`));
//     const mask = Buffer.alloc(rotated.length);
//     for (let i = 0; i < mask.length; i += 4) {
//       mask[i] = mask[i + 1] = mask[i + 2] = rotated[i + 3];
//       mask[i + 3] = 255;
//     }
//     await sharp(mask, { raw: { width: TILE, height: TILE, channels: 4 } })
//       .resize(TILE * resolution, TILE * resolution, { kernel: 'lanczos3' }).webp({ lossless: true })
//       .toFile(path.join(maskDirectory, `${definition.spriteId}.webp`));
//   }
//   const resources = {};
//   for (const [key, resource] of [...sourceStatic.resources, ...sourceDynamic.resources]) {
//     if (key.startsWith('static/') && !/^static\/(conveyor\..+\.base|pipe\..+\.(shell|fluid-body|fluid-specular|support-back|support-middle|support-front))$/.test(key)) continue;
//     const normalized = normalizedColorImages.get(key);
//     const raw = await sharp(normalized ?? resource.path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
//     const resized = await resizeAssetRgba(raw.data, raw.info.width, raw.info.height, resolution, resource.colorSpace === 'linear-data');
//     const numeric = resource.colorSpace === 'linear-data';
//     // WebP 即使 lossless 也会清除透明像素的 RGB；数值纹理必须保留全部通道。
//     const encoded = numeric ? gzipSync(resized.data, { level: 9 })
//       : resolution === 1 ? (normalized ?? await readFile(resource.path))
//         : await sharp(resized.data, { raw: { width: resized.width, height: resized.height, channels: 4 } })
//           .webp({ lossless: true }).toBuffer();
//     const digest = createHash('sha256').update(encoded).digest('hex');
//     const file = `${digest.slice(0, 16)}.${numeric ? 'rgba.bin' : 'webp'}`;
//     await writeFile(path.join(dynamicDirectory, file), encoded);
//     resources[key] = {
//       file, width: resized.width, height: resized.height,
//       data: resource.colorSpace === 'linear-data', filter: resource.filter, wrap: resource.wrap,
//     };
//   }
//   const numbers = (values) => Object.fromEntries(Object.entries(values).filter(([, value]) => typeof value === 'number'));
//   const dynamic = {
//     schemaVersion: 1, materialContractVersion: 2, resources,
//     vertex: sourceDynamic.specification.referenceShader.vertex,
//     fragment: sourceDynamic.specification.referenceShader.fragment,
//     belt: numbers(sourceDynamic.manifests.get('grid_belt_01_mid').parameters),
//     pipe: numbers(sourceDynamic.manifests.get('log_pipe_02_mid').parameters),
//   };
//   await writeFile(path.join(dynamicDirectory, 'manifest.json'), `${JSON.stringify(dynamic, null, 2)}\n`);
//   return { pages: Object.keys(manifest.pages).length, frames: Object.keys(manifest.frames).length, colors: colors.length, dynamicResources: Object.keys(resources).length };
// }
//
// if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
//   console.log(await publishLogisticsMaterials());
// }
