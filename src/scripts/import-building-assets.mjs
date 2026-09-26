#!/usr/bin/env node
/** 网站导入的发布、验收、整批应用与恢复入口；下载及无损 JSON 转换由同目录 Python 工具负责。 */
import { copyFile, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import sharp from 'sharp';
import { tsImport } from 'tsx/esm/api';
import { resolveBuildingAssetPublishTargets } from './building-asset-publish-config.mjs';
import { publishDeviceSprite, publishDeviceSpriteAnimations } from './sync-device-sprites.mjs';
// AI-REMOVED 2026-09-14: 旧实时物流发布入口退役；Trigger: 烘焙接入；Evidence: 新版 fluidPlayback 协议；Replacement: publishLogisticsBaked；Risk: Low；Human Review: Required。
// Original code: import { publishLogisticsMaterials } from './publish-logistics-materials.mjs';
import { publishLogisticsBaked } from './publish-logistics-baked.mjs';
import { publishBuildingPortEffects } from './publish-building-port-effects.mjs';
import { stageRegistryFluidColors, verifyRegistryFluidColors } from './sync-registry-fluid-colors.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const save = async (file, value) => {
  await mkdir(path.dirname(file), { recursive: true });
  // 日志以同目录 rename 替换，避免中断时留下被截断的恢复清单。
  await writeFile(`${file}.next`, `${JSON.stringify(value, null, 2)}\n`);
  await rename(`${file}.next`, file);
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const registry = async () => (await tsImport('../registry/index.ts', {
  parentURL: import.meta.url, tsconfig: path.join(projectRoot, 'tsconfig.app.json'),
})).createRegistryContract();

function within(root, relative) {
  if (typeof relative !== 'string' || !relative || /[\\%?#:]/.test(relative)
    || path.isAbsolute(relative) || relative.split('/').some((part) => !part || part === '..' || part === '.')) {
    throw new Error(`Unsafe asset path: ${relative}`);
  }
  return path.join(root, relative);
}

async function fileHash(file) {
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Expected regular file: ${file}`);
    return hash(await readFile(file));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function filesIn(root, directory = '') {
  const result = [];
  for (const item of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const relative = directory ? `${directory}/${item.name}` : item.name;
    if (item.isDirectory()) result.push(...await filesIn(root, relative));
    else if (item.isFile()) result.push(relative);
    else throw new Error(`Unsupported filesystem entry: ${relative}`);
  }
  return result.sort();
}

async function filesInIfPresent(root) {
  try { return await filesIn(root); }
  catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function sourceRootFor(batch, plan) {
  return within(batch, plan.sourceRoot);
}

function sourceUrlFor(plan, relativePath) {
  return new URL(relativePath, plan.sourceSite.siteUrl).href;
}

function isRepositorySourcePayload(relative) {
  return relative.startsWith('resources/building-assets-site/')
    || (relative.startsWith('resources/device-sprite-animation/') && !relative.endsWith('/manifest.json'));
}

async function verifyOriginals(batch, plan) {
  const receipt = await json(path.join(batch, 'source-receipt.json'));
  const root = sourceRootFor(batch, plan);
  const indexBytes = await readFile(path.join(root, 'integrity.json'));
  if (hash(indexBytes) !== receipt.indexSha256 || plan.sourceSite.indexSha256 !== receipt.indexSha256
    || plan.sourceSite.releaseId !== receipt.releaseId) throw new Error('Original root index changed');
  const indexed = new Map(JSON.parse(indexBytes.toString('utf8')).files.map((entry) => [entry.path, entry]));
  for (const file of receipt.files) {
    const entry = indexed.get(file.path);
    if (entry?.sha256 !== file.sha256 || entry?.bytes !== file.bytes) throw new Error(`Source receipt differs from index: ${file.path}`);
    const bytes = await readFile(within(root, file.path));
    if (bytes.length !== file.bytes || hash(bytes) !== file.sha256) throw new Error(`Original integrity mismatch: ${file.path}`);
  }
  return receipt;
}

/** 每类素材显式传入同一个 target，任何失败都只留下暂存产物。 */
export async function publishWebsiteBatch(batch, category = 'all') {
  if (!['all', 'static', 'animations', 'logistics', 'effects'].includes(category)) throw new Error(`Unknown publish category: ${category}`);
  const includes = (value) => category === 'all' || category === value;
  batch = path.resolve(batch);
  const stage = path.join(batch, 'stage');
  const plan = await json(path.join(batch, 'import-plan.json'));
  const collection = await json(path.join(plan.scope === 'logistics' ? projectRoot : stage, 'resources/building-top-view-v15.json'));
  const selectedEntityIds = new Set(plan.entries.map((entry) => entry.entityId));
  const selectedMappingsAreComplete = plan.entries.length > 0
    && plan.entries.every((entry) => collection.entries.some((candidate) => candidate.entityId === entry.entityId));
  if (plan.scope === 'buildings' && ((!plan.logistics && !plan.deferredCategories?.includes('logistics'))
    || plan.entries.length !== collection.entries.length
    || collection.entries.some((entry) => !selectedEntityIds.has(entry.entityId)))) {
    throw new Error('Complete building import requires the complete approved mapping and logistics collection');
  }
  if (plan.scope === 'entities' && (plan.logistics || !selectedMappingsAreComplete)) {
    throw new Error('Entity-scoped import requires one or more approved building mappings and excludes logistics');
  }
  await verifyOriginals(batch, plan);
  const definitions = await registry();
  for (const entry of plan.entries) {
    const definition = definitions.entityDefinitions.find((candidate) => candidate.id === entry.entityId);
    if (definition?.spriteId !== entry.spriteId || Boolean(definition.spriteAnimation) !== entry.animated) {
      throw new Error(`Registry mapping/animation capability differs: ${entry.entityId}`);
    }
  }
  const root = sourceRootFor(batch, plan);
  const targets = resolveBuildingAssetPublishTargets(path.join(stage, 'public/3d-top-view'));
  if (plan.sourceResolution !== 0.5 || targets.some((target) => target.resolution > plan.sourceResolution)) {
    throw new Error(`Unsupported source/target resolutions: ${plan.sourceResolution}`);
  }
  if (plan.deferredCategories?.includes('logistics') && ['all', 'logistics', 'effects'].includes(category)) {
    throw new Error('Deferred logistics batch is already assembled; validate/apply it, or prepare a new batch before republishing shared manifests');
  }
  if (plan.deferredCategories?.includes('effects') && ['all', 'effects'].includes(category)) {
    throw new Error('Port effects are retained for this batch');
  }
  const registryFluidColors = includes('logistics') && plan.logistics
    ? await stageRegistryFluidColors({
      profileFile: path.join(root, 'buildings/logistics/fluid-profiles.json'),
      profileSourceUrl: sourceUrlFor(plan, 'buildings/logistics/fluid-profiles.json'),
      registryFile: path.join(projectRoot, 'src/registry/item-definition.ts'),
      outputFile: within(stage, 'src/registry/item-definition.ts'),
    })
    : null;
  if (registryFluidColors) plan.registryFluidColors = registryFluidColors;
  const results = [];
  for (const target of targets) {
    const { outputDirectory, resolution } = target;
    const spriteDirectory = path.join(outputDirectory, 'sprites');
    const maskDirectory = path.join(outputDirectory, 'sprite-masks');
    console.log(`Publishing resolution ${resolution}: ${plan.statics.length} static / ${plan.animations.length} animated`);
    if (includes('static')) for (const item of plan.statics) {
      await publishDeviceSprite(within(root, item.sourcePath), path.join(spriteDirectory, `${item.spriteId}.webp`),
        path.join(maskDirectory, `${item.spriteId}.webp`), path.join(projectRoot, `resources/device-sprite-mask-overrides/${item.spriteId}.webp`),
        0, { crop: { left: 0, top: 0, width: item.physicalWidth, height: item.physicalHeight },
          frameTransform: 'flip-top-bottom', sourceResolution: item.sourceResolution, resolution });
    }
    if (includes('animations')) for (const spriteId of plan.animations) {
      const result = await publishDeviceSpriteAnimations({ definitions: definitions.entityDefinitions, spriteIds: new Set([spriteId]),
        sourceDirectory: path.join(stage, 'resources/device-sprite-animation'), spriteDirectory, maskDirectory,
        animationDirectory: path.join(outputDirectory, 'animations'), sourceAssetRoot: root, resolution });
      console.log(`Published ${spriteId}: ${JSON.stringify(result)}`);
    }
    let logistics = null;
    if (includes('logistics') && plan.logistics) {
      // 只清理本批暂存中由此类别独占的目录，避免失败重试留下未引用的旧编码文件。
      await rm(path.join(outputDirectory, 'logistics'), { recursive: true, force: true });
      await rm(path.join(outputDirectory, 'animations/logistics-contract2'), { recursive: true, force: true });
      logistics = await publishLogisticsBaked({ sourceDirectory: path.join(root, 'buildings/logistics'),
        outputDirectory: path.join(outputDirectory, 'logistics'), spriteDirectory, maskDirectory,
        sourceResolution: plan.sourceResolution, resolution, sourceSite: plan.sourceSite,
        fluidPlaybackDirectory: path.join(projectRoot, path.relative(stage, outputDirectory), 'logistics/baked') });
      const baked = await json(path.join(outputDirectory, 'logistics/baked/manifest.json'));
      if (baked.fluidSourceSite) for (const id of ['fluid-data', 'gas-field']) {
        const page = baked.pages[id];
        const relative = `${path.relative(stage, outputDirectory)}/logistics/baked/${page.file}`;
        plan.retainedProducts = [...(plan.retainedProducts ?? []).filter((entry) => entry.path !== relative),
          { path: relative, sha256: page.sha256 }];
      }
    }
    const heights = includes('effects') ? await publishBuildingPortEffects({ sourceDirectory: root, outputDirectory: path.join(outputDirectory, 'port-effects'),
      viewSources: plan.views, sourceVersion: plan.sourceSite.sourceVersion,
      collection: { entries: collection.entries.filter((entry) => plan.entries.some((selected) => selected.entityId === entry.entityId)) },
      sourceResolution: plan.sourceResolution, resolution }) : null;
    if (heights?.issues.length) throw new Error(`Height/effect bindings unresolved: ${JSON.stringify(heights.issues)}`);
    if (heights && (plan.scope === 'logistics' || plan.scope === 'entities')) {
      plan.retainedProducts = [...(plan.retainedProducts ?? []).filter((entry) => !entry.path.startsWith(`${path.relative(stage, outputDirectory)}/port-effects/`)),
        ...await retainWebsiteEffects(stage, outputDirectory, new Set(plan.views.map((view) => `${view.buildingId}/${view.view}`)))];
    }
    results.push({ resolution, outputDirectory: path.relative(stage, outputDirectory), logistics, registryFluidColors,
      heightViews: heights && Object.keys(heights.views).length, sharedEffects: heights && Object.keys(heights.effects).length });
  }
  await save(path.join(batch, `publish-result.${category}.json`), results);
  await save(path.join(batch, 'import-plan.json'), plan);
  if (category === 'all') return validateWebsiteBatch(batch);
  console.log(`Published category ${category}; run validate after all four categories finish`);
}

/** 局部导入只替换对应高度视图；其他建筑与共享特效按原样保留。 */
async function retainWebsiteEffects(stage, outputDirectory, selectedViews) {
  const prefix = `${path.relative(stage, outputDirectory)}/port-effects`;
  const current = await json(within(projectRoot, `${prefix}/manifest.json`));
  const next = await json(within(stage, `${prefix}/manifest.json`));
  const retained = new Map();
  const retain = async (file) => {
    const relative = `${prefix}/${file}`;
    await mkdir(path.dirname(within(stage, relative)), { recursive: true });
    await copyFile(within(projectRoot, relative), within(stage, relative));
    retained.set(relative, { path: relative, sha256: await fileHash(within(stage, relative)) });
  };
  for (const [key, view] of Object.entries(current.views)) if (!selectedViews.has(key)) {
    next.views[key] = view;
    for (const field of Object.values(view.fields)) await retain(field.file);
  }
  next.definitions = { ...current.definitions, ...next.definitions };
  for (const [key, effect] of Object.entries(current.effects)) {
    if (next.effects[key]) continue;
    next.effects[key] = effect;
    await retain(effect.height.file);
    for (const page of effect.pages) await retain(page.file);
  }
  const fields = Object.values(next.views).flatMap((view) => Object.values(view.fields));
  next.heightMin = Math.min(...fields.map((field) => field.min));
  next.heightMax = Math.max(...fields.map((field) => field.max));
  await save(within(stage, `${prefix}/manifest.json`), next);
  return [...retained.values()];
}

/** 本批只更新外观时，把当前端口特效逐文件固定为 retained 产物。 */
export async function retainWebsitePortEffects(batch, destinationRoot = projectRoot) {
  batch = path.resolve(batch);
  const plan = await json(path.join(batch, 'import-plan.json'));
  if (plan.deferredCategories?.includes('effects')) throw new Error('Port effects are already retained');
  await verifyOriginals(batch, plan);
  const stage = path.join(batch, 'stage');
  const retained = [];
  for (const { outputDirectory } of resolveBuildingAssetPublishTargets(path.join(stage, 'public/3d-top-view'))) {
    const relativeRoot = `${path.relative(stage, outputDirectory)}/port-effects`;
    const currentRoot = within(destinationRoot, relativeRoot);
    const stagedRoot = within(stage, relativeRoot);
    if ((await filesInIfPresent(stagedRoot)).length) throw new Error(`Port effects already staged: ${relativeRoot}`);
    for (const file of await filesIn(currentRoot)) {
      const relative = `${relativeRoot}/${file}`;
      await mkdir(path.dirname(within(stage, relative)), { recursive: true });
      await copyFile(within(destinationRoot, relative), within(stage, relative));
      retained.push({ path: relative, sha256: await fileHash(within(stage, relative)) });
    }
  }
  plan.retainedProducts = [...(plan.retainedProducts ?? []), ...retained];
  plan.deferredCategories = [...(plan.deferredCategories ?? []), 'effects'];
  await save(path.join(batch, 'import-plan.json'), plan);
  console.log(`Retained ${retained.length} current port-effect files`);
}

/** 从已发布但尚未应用的批次中排除物流新交付，共享高度清单保留当前未导入的视图。 */
export async function deferWebsiteLogistics(batch, destinationRoot = projectRoot) {
  batch = path.resolve(batch);
  if (await fileHash(path.join(batch, 'apply-journal.json'))) throw new Error('Cannot change scope after apply starts');
  const plan = await json(path.join(batch, 'import-plan.json'));
  if (plan.deferredCategories?.includes('logistics')) throw new Error('Logistics already deferred; continue with validate');
  if (!plan.logistics) throw new Error('Batch has no logistics collection');
  await verifyOriginals(batch, plan);
  const stage = path.join(batch, 'stage');
  const selectedViews = new Set(plan.views.filter((view) => !view.directory.startsWith('buildings/logistics/'))
    .map((view) => `${view.buildingId}/${view.view}`));
  const retained = [];
  const deferred = [];
  for (const { outputDirectory } of resolveBuildingAssetPublishTargets(path.join(stage, 'public/3d-top-view'))) {
    const prefix = path.relative(stage, outputDirectory);
    for (const directory of ['logistics', 'animations/logistics-contract2']) {
      const current = within(destinationRoot, `${prefix}/${directory}`);
      for (const file of await filesIn(current)) deferred.push({ path: `${prefix}/${directory}/${file}`, sha256: await fileHash(within(current, file)) });
      await rm(path.join(outputDirectory, directory), { recursive: true, force: true });
    }
    for (const kind of ['belt', 'pipe']) for (const shape of ['straight', 'turn_cw', 'turn_ccw']) {
      for (const directory of ['sprites', 'sprite-masks']) {
        const file = `${prefix}/${directory}/${kind}_${shape}_1x1.webp`;
        deferred.push({ path: file, sha256: await fileHash(within(destinationRoot, file)) });
        await rm(within(stage, file), { force: true });
      }
    }
    const relative = `${prefix}/port-effects`;
    const current = await json(within(destinationRoot, `${relative}/manifest.json`));
    const next = await json(within(stage, `${relative}/manifest.json`));
    for (const [key, view] of Object.entries(current.views)) {
      if (selectedViews.has(key)) continue;
      next.views[key] = view;
      for (const field of Object.values(view.fields)) {
        const file = `${relative}/${field.file}`;
        const sha256 = await fileHash(within(destinationRoot, file));
        await mkdir(path.dirname(within(stage, file)), { recursive: true });
        await copyFile(within(destinationRoot, file), within(stage, file));
        retained.push({ path: file, sha256 });
      }
    }
    // 每张图按自身 min/max 解码；全局范围用于运行时重编码，须涵盖合并后的全部视图。
    const fields = Object.values(next.views).flatMap((view) => Object.values(view.fields));
    next.heightMin = Math.min(...fields.map((field) => field.min));
    next.heightMax = Math.max(...fields.map((field) => field.max));
    const referenced = new Set(['manifest.json']);
    for (const view of Object.values(next.views)) for (const field of Object.values(view.fields)) referenced.add(field.file);
    for (const effect of Object.values(next.effects)) {
      referenced.add(effect.height.file);
      for (const page of effect.pages) referenced.add(page.file);
    }
    for (const file of await filesIn(within(stage, relative))) if (!referenced.has(file)) await rm(within(stage, `${relative}/${file}`));
    await save(within(stage, `${relative}/manifest.json`), next);
  }
  const receipt = await json(path.join(batch, 'source-receipt.json'));
  await save(path.join(batch, 'source-receipt.before-deferral.json'), receipt);
  receipt.files = receipt.files.filter((file) => !file.path.startsWith('buildings/logistics/'));
  receipt.logistics = false;
  receipt.deferredCategories = ['logistics'];
  plan.logistics = false;
  plan.deferredCategories = ['logistics'];
  plan.views = plan.views.filter((view) => !view.directory.startsWith('buildings/logistics/'));
  plan.retainedProducts = [...new Map(retained.map((entry) => [entry.path, entry])).values()];
  await rm(within(sourceRootFor(batch, plan), 'buildings/logistics'), { recursive: true });
  await save(path.join(batch, 'source-receipt.json'), receipt);
  await save(path.join(batch, 'import-plan.json'), plan);
  await save(path.join(batch, 'deferred-logistics.json'), { categories: ['logistics'], unchangedFiles: deferred, retainedProducts: plan.retainedProducts });
  await rm(path.join(batch, 'application-plan.json'), { force: true });
  console.log(`Deferred logistics; preserved ${deferred.length} material files and ${plan.retainedProducts.length} height files. Run validate.`);
}

async function verifyImage(root, file, width, height, numeric = false) {
  if (![width, height].every((n) => Number.isSafeInteger(n) && n > 0)) throw new Error(`Invalid dimensions: ${file}`);
  const bytes = await readFile(within(root, file));
  if (numeric) {
    const rgba = gunzipSync(bytes);
    if (rgba.length !== width * height * 4) throw new Error(`Height length differs: ${file}`);
    if (numeric === true) for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 2] !== 0 || ![0, 255].includes(rgba[i + 3])) throw new Error(`Height encoding differs: ${file}`);
  } else {
    const image = await sharp(bytes).metadata();
    if (image.format !== 'webp' || image.width !== width || image.height !== height) throw new Error(`Image dimensions differ: ${file}`);
  }
}

function verifyRect(rect, page) {
  const [x, y, width, height] = rect;
  if (!rect.every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0
    || x + width > page.width || y + height > page.height) throw new Error(`Atlas rectangle out of bounds: ${rect}`);
}

/** 验收真实图片、数值字节、页引用和四阶段时间线，并记录每项写入前的摘要。 */
export async function validateWebsiteBatch(batch) {
  batch = path.resolve(batch);
  const stage = path.join(batch, 'stage');
  const plan = await json(path.join(batch, 'import-plan.json'));
  const receipt = await verifyOriginals(batch, plan);
  const collection = await json(path.join(plan.scope === 'logistics' ? projectRoot : stage, 'resources/building-top-view-v15.json'));
  const targets = resolveBuildingAssetPublishTargets(path.join(stage, 'public/3d-top-view'));
  const animationProtocol = await tsImport('../shared/device-sprite-animation.ts', { parentURL: import.meta.url, tsconfig: path.join(projectRoot, 'tsconfig.app.json') });
  const definitions = await registry();
  let registryFluidColors = null;
  if (plan.logistics) {
    if (!plan.registryFluidColors || await fileHash(path.join(projectRoot, 'src/registry/item-definition.ts')) !== plan.registryFluidColors.sourceSha256) {
      throw new Error('Registry item definitions changed after fluid colors were staged');
    }
    registryFluidColors = await verifyRegistryFluidColors({
      profileFile: path.join(sourceRootFor(batch, plan), 'buildings/logistics/fluid-profiles.json'),
      profileSourceUrl: sourceUrlFor(plan, 'buildings/logistics/fluid-profiles.json'),
      registryFile: within(stage, 'src/registry/item-definition.ts'),
    });
  }
  for (const { outputDirectory: root, resolution } of targets) {
    for (const selected of plan.entries) {
      const entry = collection.entries.find((candidate) => candidate.entityId === selected.entityId);
      const { width, height } = entry.sourceMetadata.spatial.framePixels;
      for (const folder of ['sprites', 'sprite-masks']) await verifyImage(root, `${folder}/${entry.spriteId}.webp`, width * resolution, height * resolution);
      if (!entry.animated) continue;
      const directory = path.join(root, 'animations', entry.spriteId);
      const manifest = await json(path.join(directory, 'manifest.json'));
      const definition = definitions.entityDefinitions.find((candidate) => candidate.id === entry.entityId);
      const animation = animationProtocol.normalizeDeviceSpriteAnimationDefinition(definition.spriteAnimation, manifest);
      if (animation.resolution !== resolution || manifest.sourceResolution !== plan.sourceResolution
        || manifest.sourceSite.indexSha256 !== receipt.indexSha256) throw new Error(`Animation provenance differs: ${entry.spriteId}`);
      await verifyImage(directory, animation.maskFile, width * resolution, height * resolution);
      for (const clip of Object.values(animation.clips)) for (const page of clip.pages) {
        await verifyImage(directory, page.file, page.columns * width * resolution, page.rows * height * resolution);
      }
    }
    const effectsRoot = path.join(root, 'port-effects');
    const heights = await json(path.join(effectsRoot, 'manifest.json'));
    for (const view of Object.values(heights.views)) for (const field of Object.values(view.fields)) {
      await verifyImage(effectsRoot, field.file, field.width, field.height, true);
    }
    for (const effect of Object.values(heights.effects)) {
      await verifyImage(effectsRoot, effect.height.file, effect.height.width, effect.height.height, true);
      for (const page of effect.pages) await verifyImage(effectsRoot, page.file, page.width, page.height);
      for (const frame of effect.frames) {
        verifyRect([frame.x, frame.y, frame.width, frame.height], effect.pages[frame.page]);
        if (!(frame.durationMs > 0)) throw new Error('Invalid effect frame duration');
      }
    }
    if (plan.logistics) {
      const directory = path.join(root, 'logistics/static');
      const material = await json(path.join(directory, 'manifest.json'));
      for (const page of Object.values(material.pages)) await verifyImage(directory, page.file, page.width, page.height);
      for (const frame of Object.values(material.frames)) verifyRect(frame.rect, material.pages[frame.page]);
      const dynamicRoot = path.join(root, 'logistics/baked');
      const dynamic = await json(path.join(dynamicRoot, 'manifest.json'));
      if (dynamic.schemaVersion !== 2 || dynamic.format !== 'logistics-spritesheet-v2'
        || dynamic.sourceResolution !== plan.sourceResolution || dynamic.resolution !== resolution) throw new Error('Invalid baked manifest');
      if (dynamic.cargoBox?.file !== 'cargo/empty-box.webp'
        || dynamic.cargoBox.width !== 128 * resolution || dynamic.cargoBox.height !== 128 * resolution
        || dynamic.cargoBox.visibleFootprintCells?.[0] !== 0.5
        || dynamic.cargoBox.visibleFootprintCells?.[1] !== 0.5) throw new Error('Invalid cargo box delivery');
      const logisticsRoot = path.join(root, 'logistics');
      await verifyImage(logisticsRoot, dynamic.cargoBox.file, dynamic.cargoBox.width, dynamic.cargoBox.height);
      if (await fileHash(path.join(logisticsRoot, dynamic.cargoBox.file)) !== dynamic.cargoBox.sha256) {
        throw new Error('Cargo box product hash differs');
      }
      for (const resource of Object.values(dynamic.pages)) {
        await verifyImage(dynamicRoot, resource.file, resource.width, resource.height, resource.data ? 'rgba' : false);
        if (await fileHash(path.join(dynamicRoot, resource.file)) !== resource.sha256) throw new Error(`Baked product hash differs: ${resource.file}`);
      }
      for (const frame of Object.values(dynamic.frames)) verifyRect(frame.rect, dynamic.pages[frame.page]);
      for (const clip of Object.values(dynamic.clips)) {
        if (clip.frames.length !== clip.phaseSamples || [...clip.frames, ...(clip.tintFrames ?? [])].some((key) => !dynamic.frames[key])
          || (clip.tintFrames && clip.tintFrames.length !== clip.phaseSamples)) throw new Error('Baked clip references missing frame');
      }
    }
  }
  const products = [];
  const retained = new Map((plan.retainedProducts ?? []).map((entry) => [entry.path, entry.sha256]));
  for (const file of await filesIn(path.join(stage, 'public'))) {
    const relative = `public/${file}`;
    if (plan.deferredCategories?.includes('logistics') && /(?:\/logistics\/|\/animations\/logistics-contract2\/|\/(?:sprites|sprite-masks)\/(?:belt|pipe)_(?:straight|turn_cw|turn_ccw)_1x1\.webp$)/.test(relative)) {
      throw new Error(`Deferred logistics product is staged: ${relative}`);
    }
    if (retained.has(relative)) {
      if (await fileHash(within(stage, relative)) !== retained.get(relative)) throw new Error(`Retained height changed: ${relative}`);
      products.push({ path: relative, sha256: retained.get(relative), retained: true });
      continue;
    }
    const target = [...targets].reverse().find((item) => within(stage, relative).startsWith(`${item.outputDirectory}/`));
    const spriteId = plan.entries.find((entry) => file.includes(`/${entry.spriteId}.`) || file.includes(`/${entry.spriteId}/`));
    const sourcePrefix = spriteId ? `buildings/${spriteId.sourcePath}/` : file.includes('logistics') ? 'buildings/logistics/' : 'buildings/';
    products.push({ path: relative, sha256: await fileHash(within(stage, relative)), resolution: target.resolution, sourcePrefix });
  }
  await save(path.join(batch, `publish-receipt${plan.receiptHistorySuffix ?? ''}.json`), {
    schemaVersion: 1, sourceSite: plan.sourceSite, sources: receipt.files.map(({ path: file, sha256 }) => ({ path: file, sha256 })),
    products, registryFluidColors,
  });
  const stagedFiles = await filesIn(stage);
  const stagedSources = stagedFiles.filter(isRepositorySourcePayload);
  if (stagedSources.length) throw new Error(`Website source payload must remain in the temporary batch: ${stagedSources[0]}`);
  const application = [];
  for (const file of stagedFiles) application.push({ path: file, sha256: await fileHash(within(stage, file)), previousSha256: await fileHash(within(projectRoot, file)) });
  if (plan.logistics) for (const { outputDirectory } of targets) {
    for (const directory of ['logistics', 'animations/logistics-contract2']) {
      const managedRoot = path.relative(stage, path.join(outputDirectory, directory));
      for (const file of await filesInIfPresent(within(projectRoot, managedRoot))) {
        const relative = `${managedRoot}/${file}`;
        if (!stagedFiles.includes(relative)) application.push({ path: relative, sha256: null, previousSha256: await fileHash(within(projectRoot, relative)) });
      }
    }
  }
  application.sort((left, right) => left.path.localeCompare(right.path));
  await save(path.join(batch, 'application-plan.json'), application);
  console.log(`Validated ${receipt.files.length} source files, ${products.length} products, ${application.length} apply files`);
  return { sources: receipt.files.length, products: products.length, files: application.length };
}

/** 恢复只触及本次写入清单；摘要不匹配表示后续有人编辑，必须保留副本并停止覆盖。 */
export async function restoreWebsiteBatch(batch, destinationRoot = projectRoot) {
  const journal = await json(path.join(batch, 'apply-journal.json'));
  for (const entry of [...journal.entries].reverse()) {
    const target = within(destinationRoot, entry.path);
    const actual = await fileHash(target);
    if (actual === entry.previousSha256) continue;
    if (actual !== entry.sha256) throw new Error(`Cannot restore modified file: ${entry.path}`);
    if (entry.previousSha256 === null) await rm(target);
    else {
      const backup = within(path.join(batch, 'backup'), entry.path);
      if (await fileHash(backup) !== entry.previousSha256) throw new Error(`Backup integrity differs: ${entry.path}`);
      await copyFile(backup, target);
    }
  }
  journal.status = 'restored';
  await save(path.join(batch, 'apply-journal.json'), journal);
}

export async function applyWebsiteBatch(batch, destinationRoot = projectRoot) {
  batch = path.resolve(batch);
  const application = await json(path.join(batch, 'application-plan.json'));
  if (destinationRoot === projectRoot) {
    const plan = await json(path.join(batch, 'import-plan.json'));
    // AI-CORRECTION 2026-09-14: 用户已授权烘焙运行时，只允许新版物流协议进入正式目录。
    if (plan.logistics) {
      const manifest = await json(path.join(batch, 'stage/public/3d-top-view/logistics/baked/manifest.json'));
      if (manifest.format !== 'logistics-spritesheet-v2') throw new Error('Website logistics requires baked playback');
    }
    if (application.some((entry) => entry.path !== 'src/registry/item-definition.ts'
      && !entry.path.startsWith('resources/') && !entry.path.startsWith('public/3d-top-view/'))) {
      throw new Error('Application plan contains files outside building resources or Registry fluid colors');
    }
    const sourcePayload = application.find((entry) => isRepositorySourcePayload(entry.path));
    if (sourcePayload) throw new Error(`Application plan contains website source payload: ${sourcePayload.path}`);
    const collection = await json(path.join(plan.scope === 'logistics' ? projectRoot : path.join(batch, 'stage'), 'resources/building-top-view-v15.json'));
    const definitions = await registry();
    const drawingBoundsEntries = plan.scope === 'entities'
      ? collection.entries.filter((entry) => plan.entries.some((selected) => selected.entityId === entry.entityId))
      : collection.entries;
    const differences = drawingBoundsEntries.filter((entry) => {
      const definition = definitions.entityDefinitions.find((candidate) => candidate.id === entry.entityId);
      const offset = definition.spriteOffset?.topView ?? { x: 0, y: 0, ...definition.footprint };
      return ['x', 'y', 'width', 'height'].some((key) => offset[key] !== entry.spriteOffset[key]);
    }).map((entry) => ({ entityId: entry.entityId, expected: entry.spriteOffset }));
    if (differences.length) throw new Error(`Registry drawing bounds differ: ${JSON.stringify(differences)}`);
  }
  const journalPath = path.join(batch, 'apply-journal.json');
  if (await fileHash(journalPath)) throw new Error('Batch already has an apply journal; inspect it before continuing');
  for (const entry of application) {
    if (await fileHash(within(path.join(batch, 'stage'), entry.path)) !== entry.sha256) throw new Error(`Staged product changed: ${entry.path}`);
    if (await fileHash(within(destinationRoot, entry.path)) !== entry.previousSha256) throw new Error(`Destination changed after validation: ${entry.path}`);
    if (entry.previousSha256 !== null) {
      const backup = within(path.join(batch, 'backup'), entry.path);
      await mkdir(path.dirname(backup), { recursive: true });
      await copyFile(within(destinationRoot, entry.path), backup);
      if (await fileHash(backup) !== entry.previousSha256) throw new Error(`Backup changed during copying: ${entry.path}`);
    }
  }
  const journal = { status: 'applying', entries: [] };
  await save(journalPath, journal);
  try {
    for (const entry of application) {
      if (entry.sha256 === entry.previousSha256) continue;
      const destination = within(destinationRoot, entry.path);
      if (await fileHash(destination) !== entry.previousSha256) throw new Error(`Destination changed during apply: ${entry.path}`);
      await mkdir(path.dirname(destination), { recursive: true });
      journal.entries.push(entry);
      await save(journalPath, journal);
      if (entry.sha256 === null) await rm(destination);
      else {
        const next = path.join(batch, 'apply-next');
        await copyFile(within(path.join(batch, 'stage'), entry.path), next);
        await rename(next, destination);
      }
      if (await fileHash(destination) !== entry.sha256) throw new Error(`Applied file integrity differs: ${entry.path}`);
    }
    journal.status = 'applied';
    await save(journalPath, journal);
  } catch (error) {
    try { await restoreWebsiteBatch(batch, destinationRoot); }
    catch (restoreError) { throw new AggregateError([error, restoreError], 'Apply and recovery failed; preserve batch backup'); }
    throw error;
  }
  console.log(`Applied ${journal.entries.length} files; recovery backup: ${path.join(batch, 'backup')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, batch] = process.argv.slice(2);
  const commands = { publish: publishWebsiteBatch, 'defer-logistics': deferWebsiteLogistics,
    'retain-effects': retainWebsitePortEffects, validate: validateWebsiteBatch, apply: applyWebsiteBatch, restore: restoreWebsiteBatch,
    ...Object.fromEntries(['static', 'animations', 'logistics', 'effects'].map((category) => [`publish-${category}`, (directory) => publishWebsiteBatch(directory, category)])) };
  if (!commands[command] || !batch || process.argv.length !== 4) throw new Error('Usage: node src/scripts/import-building-assets.mjs <publish[-static|-animations|-logistics|-effects]|defer-logistics|retain-effects|validate|apply|restore> <batch-directory>');
  await commands[command](batch);
}
