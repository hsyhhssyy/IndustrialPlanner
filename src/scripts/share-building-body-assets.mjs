import { createHash } from 'node:crypto';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const digest = async (file) => createHash('sha256').update(await readFile(file)).digest('hex');
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));

export function buildingBodyPairs(collection) {
  return collection.entries.flatMap((variant) => {
    const baseView = variant.sourceMetadata?.package?.sharedRenderedFramesFrom;
    if (!baseView) return [];
    const building = variant.sourcePath.split('/')[0];
    const base = collection.entries.find((entry) => entry.sourcePath === `${building}/${baseView}`);
    if (!base) throw new Error(`Missing body sharing target for ${variant.spriteId}: ${baseView}`);
    return [{ base, variant }];
  });
}

/** 同一批次发布后核对实际产物；仅精确相同的本体才共享颜色、遮罩和动画页。 */
export async function sharePublishedBuildingBodies(root, collection, selectedEntityIds, existingRoot = root, sourceRoot = null) {
  const aliasFile = path.join(root, 'body-aliases.json');
  let aliases;
  try { aliases = await readJson(aliasFile); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try { aliases = await readJson(path.join(existingRoot, 'body-aliases.json')); }
    catch (existingError) {
      if (existingError.code !== 'ENOENT') throw existingError;
      aliases = {};
    }
  }
  for (const { base, variant } of buildingBodyPairs(collection)) {
    const hasBase = selectedEntityIds.has(base.entityId);
    const hasVariant = selectedEntityIds.has(variant.entityId);
    if (hasBase !== hasVariant) throw new Error(`Body sharing pair must be published together: ${base.entityId}, ${variant.entityId}`);
    if (!hasBase) continue;

    const baseRoot = path.join(root, 'animations', base.spriteId);
    const variantRoot = path.join(root, 'animations', variant.spriteId);
    const baseManifest = await readJson(path.join(baseRoot, 'manifest.json'));
    const variantManifest = await readJson(path.join(variantRoot, 'manifest.json'));
    let sameHeight = JSON.stringify(base.sourceMetadata.package.occlusionMetadata)
      === JSON.stringify(variant.sourceMetadata.package.occlusionMetadata);
    if (sameHeight && sourceRoot) {
      const occlusion = async (entry) => {
        const directory = path.join(sourceRoot, 'buildings', entry.sourcePath, 'occlusion');
        const metadata = await readJson(path.join(directory, 'occlusion.json'));
        const fields = await Promise.all(metadata.fields.map(async (field) =>
          [field.name, await digest(path.join(directory, field.file))]));
        return { metadata, fields };
      };
      sameHeight = JSON.stringify(await occlusion(base)) === JSON.stringify(await occlusion(variant));
    }
    const sameGeometry = JSON.stringify(base.sourceMetadata.spatial.framePixels)
      === JSON.stringify(variant.sourceMetadata.spatial.framePixels);
    const sameManifest = JSON.stringify(baseManifest) === JSON.stringify(variantManifest);
    const files = await readdir(variantRoot);
    const sameAnimation = (await Promise.all(files.filter((file) => file.endsWith('.webp')).map(async (file) =>
      (await digest(path.join(variantRoot, file))) === (await digest(path.join(baseRoot, file)))))).every(Boolean);
    const sameStatic = (await Promise.all(['sprites', 'sprite-masks'].map(async (folder) =>
      (await digest(path.join(root, folder, `${base.spriteId}.webp`)))
        === (await digest(path.join(root, folder, `${variant.spriteId}.webp`)))))).every(Boolean);
    if (!sameHeight || !sameGeometry || !sameManifest || !sameAnimation || !sameStatic) {
      delete aliases[variant.spriteId];
      continue;
    }

    aliases[variant.spriteId] = base.spriteId;
    variantManifest.sharedAnimationId = base.spriteId;
    await writeFile(path.join(variantRoot, 'manifest.json'), `${JSON.stringify(variantManifest, null, 2)}\n`);
    for (const file of files.filter((file) => file.endsWith('.webp'))) await rm(path.join(variantRoot, file));
    for (const folder of ['sprites', 'sprite-masks']) await rm(path.join(root, folder, `${variant.spriteId}.webp`));
  }
  await writeFile(aliasFile, `${JSON.stringify(aliases, null, 2)}\n`);
  return aliases;
}
