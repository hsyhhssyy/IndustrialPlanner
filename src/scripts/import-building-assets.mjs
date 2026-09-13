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
import { publishLogisticsMaterials } from './publish-logistics-materials.mjs';
import { publishBuildingPortEffects } from './publish-building-port-effects.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const save = async (file, value) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
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

async function verifyOriginals(batch, plan) {
  const receipt = await json(path.join(batch, 'source-receipt.json'));
  const root = within(path.join(batch, 'stage'), plan.sourceSite.root);
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
  const collection = await json(path.join(stage, 'resources/building-top-view-v15.json'));
  if (!plan.logistics || plan.entries.length !== collection.entries.length
    || collection.entries.some((entry) => !plan.entries.some((selected) => selected.entityId === entry.entityId))) {
    throw new Error('Publishing requires the complete approved mapping and logistics collection; partial import is not implemented');
  }
  await verifyOriginals(batch, plan);
  const definitions = await registry();
  for (const entry of plan.entries) {
    const definition = definitions.entityDefinitions.find((candidate) => candidate.id === entry.entityId);
    if (definition?.spriteId !== entry.spriteId || Boolean(definition.spriteAnimation) !== entry.animated) {
      throw new Error(`Registry mapping/animation capability differs: ${entry.entityId}`);
    }
  }
  const root = within(stage, plan.sourceSite.root);
  const targets = resolveBuildingAssetPublishTargets(path.join(stage, 'public/3d-top-view'));
  const results = [];
  for (const target of targets) {
    const { outputDirectory, resolution } = target;
    const spriteDirectory = path.join(outputDirectory, 'sprites');
    const maskDirectory = path.join(outputDirectory, 'sprite-masks');
    console.log(`Publishing resolution ${resolution}: ${plan.statics.length} static / ${plan.animations.length} animated`);
    if (includes('static')) for (const item of plan.statics) {
      await publishDeviceSprite(within(root, item.sourcePath), path.join(spriteDirectory, `${item.spriteId}.webp`),
        path.join(maskDirectory, `${item.spriteId}.webp`), path.join(projectRoot, `resources/device-sprite-mask-overrides/${item.spriteId}.webp`),
        0, { crop: { left: 0, top: 0, width: item.width, height: item.height }, frameTransform: 'flip-top-bottom', resolution });
    }
    if (includes('animations')) for (const spriteId of plan.animations) {
      const result = await publishDeviceSpriteAnimations({ definitions: definitions.entityDefinitions, spriteIds: new Set([spriteId]),
        sourceDirectory: path.join(stage, 'resources/device-sprite-animation'), spriteDirectory, maskDirectory,
        animationDirectory: path.join(outputDirectory, 'animations'), resolution });
      console.log(`Published ${spriteId}: ${JSON.stringify(result)}`);
    }
    let logistics = null;
    if (includes('logistics') && plan.logistics) {
      // 只清理本批暂存中由此类别独占的目录，避免失败重试留下未引用的旧编码文件。
      await rm(path.join(outputDirectory, 'logistics'), { recursive: true, force: true });
      await rm(path.join(outputDirectory, 'animations/logistics-contract2'), { recursive: true, force: true });
      logistics = await publishLogisticsMaterials({ sourceDirectory: path.join(root, 'buildings/logistics'),
      websiteCollection: await json(path.join(root, 'buildings/logistics/collection.json')),
        outputDirectory: path.join(outputDirectory, 'logistics'), spriteDirectory, maskDirectory, registry: definitions, resolution });
    }
    const heights = includes('effects') ? await publishBuildingPortEffects({ sourceDirectory: root, outputDirectory: path.join(outputDirectory, 'port-effects'),
      viewSources: plan.views, sourceVersion: plan.sourceSite.sourceVersion,
      collection: { entries: collection.entries.filter((entry) => plan.entries.some((selected) => selected.entityId === entry.entityId)) }, resolution }) : null;
    if (heights?.issues.length) throw new Error(`Height/effect bindings unresolved: ${JSON.stringify(heights.issues)}`);
    results.push({ resolution, outputDirectory: path.relative(stage, outputDirectory), logistics,
      heightViews: heights && Object.keys(heights.views).length, sharedEffects: heights && Object.keys(heights.effects).length });
  }
  await save(path.join(batch, `publish-result.${category}.json`), results);
  if (category === 'all') return validateWebsiteBatch(batch);
  console.log(`Published category ${category}; run validate after all four categories finish`);
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
  if (!rect.every(Number.isSafeInteger) || x < 0 || y < 0 || width <= 0 || height <= 0
    || x + width > page.width || y + height > page.height) throw new Error(`Atlas rectangle out of bounds: ${rect}`);
}

/** 验收真实图片、数值字节、页引用和四阶段时间线，并记录每项写入前的摘要。 */
export async function validateWebsiteBatch(batch) {
  batch = path.resolve(batch);
  const stage = path.join(batch, 'stage');
  const plan = await json(path.join(batch, 'import-plan.json'));
  const receipt = await verifyOriginals(batch, plan);
  const collection = await json(path.join(stage, 'resources/building-top-view-v15.json'));
  const targets = resolveBuildingAssetPublishTargets(path.join(stage, 'public/3d-top-view'));
  const animationProtocol = await tsImport('../shared/device-sprite-animation.ts', { parentURL: import.meta.url, tsconfig: path.join(projectRoot, 'tsconfig.app.json') });
  const definitions = await registry();
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
      if (animation.resolution !== resolution || manifest.sourceSite.indexSha256 !== receipt.indexSha256) throw new Error(`Animation provenance differs: ${entry.spriteId}`);
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
      const dynamicRoot = path.join(root, 'animations/logistics-contract2');
      const dynamic = await json(path.join(dynamicRoot, 'manifest.json'));
      for (const resource of Object.values(dynamic.resources)) await verifyImage(dynamicRoot, resource.file, resource.width, resource.height, resource.data ? 'rgba' : false);
    }
  }
  const products = [];
  for (const file of await filesIn(path.join(stage, 'public'))) {
    const relative = `public/${file}`;
    const target = [...targets].reverse().find((item) => within(stage, relative).startsWith(`${item.outputDirectory}/`));
    const spriteId = plan.entries.find((entry) => file.includes(`/${entry.spriteId}.`) || file.includes(`/${entry.spriteId}/`));
    const sourcePrefix = spriteId ? `buildings/${spriteId.sourcePath}/` : file.includes('logistics') ? 'buildings/logistics/' : 'buildings/';
    products.push({ path: relative, sha256: await fileHash(within(stage, relative)), resolution: target.resolution, sourcePrefix });
  }
  await save(within(stage, `${plan.sourceSite.root}/_import/publish-receipt.json`), {
    schemaVersion: 1, sourceSite: plan.sourceSite, sources: receipt.files.map(({ path: file, sha256 }) => ({ path: file, sha256 })), products,
  });
  const application = [];
  for (const file of await filesIn(stage)) application.push({ path: file, sha256: await fileHash(within(stage, file)), previousSha256: await fileHash(within(projectRoot, file)) });
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
    if (application.some((entry) => !entry.path.startsWith('resources/') && !entry.path.startsWith('public/3d-top-view/'))) {
      throw new Error('Application plan contains files outside building resource directories');
    }
    const collection = await json(path.join(batch, 'stage/resources/building-top-view-v15.json'));
    const definitions = await registry();
    const differences = collection.entries.filter((entry) => {
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
      const next = path.join(batch, 'apply-next');
      await copyFile(within(path.join(batch, 'stage'), entry.path), next);
      await rename(next, destination);
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
  const commands = { publish: publishWebsiteBatch, validate: validateWebsiteBatch, apply: applyWebsiteBatch, restore: restoreWebsiteBatch,
    ...Object.fromEntries(['static', 'animations', 'logistics', 'effects'].map((category) => [`publish-${category}`, (directory) => publishWebsiteBatch(directory, category)])) };
  if (!commands[command] || !batch || process.argv.length !== 4) throw new Error('Usage: node src/scripts/import-building-assets.mjs <publish[-static|-animations|-logistics|-effects]|validate|apply|restore> <batch-directory>');
  await commands[command](batch);
}
