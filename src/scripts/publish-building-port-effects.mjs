import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import sharp from 'sharp';

/** 保留原件；数值图仅无损解码为 RGBA 并 gzip，避免浏览器颜色管理改变高度字节。 */
export async function publishBuildingPortEffects({
  sourceDirectory = 'resources/building-port-effects',
  outputDirectory = 'public/3d-top-view/port-effects',
} = {}) {
  const source = path.resolve(sourceDirectory);
  const output = path.resolve(outputDirectory);
  const json = async (name) => JSON.parse(await readFile(path.join(source, name), 'utf8'));
  const root = await json('assets/manifest.json');
  const collection = JSON.parse(await readFile('resources/building-top-view-v15.json', 'utf8'));
  const manifest = { schemaVersion: 1, version: root.version, profile: root.profile,
    definitions: Object.fromEntries(collection.entries.map((entry) => [entry.entityId, entry.sourcePath])),
    views: {}, effects: {}, issues: [], heightMin: Infinity, heightMax: -Infinity };
  const written = new Map();
  const publish = async (relative, numeric = false) => {
    const normalized = path.posix.normalize(relative);
    if (!normalized.startsWith('assets/')) throw new Error(`Invalid resource path: ${relative}`);
    const key = `${normalized}:${numeric}`;
    if (written.has(key)) return written.get(key);
    const file = normalized.slice('assets/'.length) + (numeric ? '.rgba.bin' : '');
    const destination = path.join(output, file);
    await mkdir(path.dirname(destination), { recursive: true });
    let result;
    if (numeric) {
      const { data, info } = await sharp(path.join(source, normalized)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 2] !== 0 || (data[i + 3] !== 0 && data[i + 3] !== 255)) {
          throw new Error(`Invalid height encoding: ${normalized} at ${i / 4}`);
        }
      }
      await writeFile(destination, gzipSync(data, { level: 9 }));
      result = { file, width: info.width, height: info.height };
    } else {
      await copyFile(path.join(source, normalized), destination);
      result = file;
    }
    written.set(key, result);
    return result;
  };
  for (const building of root.buildings) {
    const directory = path.posix.dirname(`assets/${building.package}`);
    const spatial = await json(`${directory}/spatial.json`);
    const ports = await json(`${directory}/ports.json`);
    const occlusion = await json(`${directory}/occlusion/occlusion.json`);
    const fields = {};
    for (const field of occlusion.fields) {
      fields[field.name] = { ...await publish(`${directory}/occlusion/${field.file}`, true),
        min: field.heightMin, max: field.heightMax,
        pivot: [field.worldToPixel.pivotPixels.x, field.worldToPixel.pivotPixels.y],
        center: [field.worldToPixel.cameraCenterSource.x, field.worldToPixel.cameraCenterSource.z],
        pixelsPerCell: field.worldToPixel.pixelsPerCell.x };
      manifest.heightMin = Math.min(manifest.heightMin, field.heightMin);
      manifest.heightMax = Math.max(manifest.heightMax, field.heightMax);
    }
    const transform = (value) => value && Array.isArray(value.position)
      && value.position.length === 3 && value.position.every(Number.isFinite)
      && Number.isFinite(value.yawDegrees)
      ? { position: value.position, yaw: value.yawDegrees } : null;
    const variants = {};
    for (const key of ports.deliveryVariantKeys) {
      const variant = ports.variants.find((entry) => entry.rendererTemplateKey === key);
      if (!variant) {
        manifest.issues.push({ view: directory, variant: key, reason: 'deliveryVariantKeys does not resolve to a rendererTemplateKey; no effects bound' });
        continue;
      }
      variants[key] = ['input', 'output'].flatMap((role) => variant.activePorts.pipe[role]
        .filter((port) => port.isPipe === true && port.resolvedTransform?.enabledByBinding === true
          && port.resolvedTransform.disabled !== true && transform(port.resolvedTransform))
        .map((port) => ({ role, index: port.index, ...transform(port.resolvedTransform),
          bindings: Object.fromEntries(['on', 'off', 'activateOn', 'activateOff']
            .map((state) => [state, port.resourceBinding?.[state]?.resourceId ?? null])) })));
    }
    manifest.views[`${building.buildingId}/${building.view}`] = {
      footprint: spatial.footprintRectCells,
      origin: [occlusion.fields[0].worldToPixel.pivotPixels.x / spatial.pixelsPerCell.x
        - occlusion.fields[0].worldToPixel.cameraCenterSource.x - spatial.footprintRectCells.left,
      occlusion.fields[0].worldToPixel.pivotPixels.y / spatial.pixelsPerCell.y
        - occlusion.fields[0].worldToPixel.cameraCenterSource.z - spatial.footprintRectCells.top],
      fields, stateMapping: occlusion.stateMapping, epsilon: occlusion.epsilon.value,
      variants,
      rings: ports.rings.filter((ring) => ring.resourceId && transform(ring.resolvedTransform))
        .map((ring) => ({ resourceId: ring.resourceId, statusKey: ring.statusKey, ...transform(ring.resolvedTransform) })),
    };
    const registry = await json(`${directory}/effects/resources.json`);
    for (const entry of registry.resources) {
      const id = entry.id ?? entry.resourceId;
      if (manifest.effects[id]) continue;
      const effectPath = path.posix.normalize(`${directory}/effects/${entry.path}`);
      const effectDirectory = path.posix.dirname(effectPath);
      const effect = await json(effectPath);
      if (effect.geometry.additionalPrefabTransformRequired) throw new Error(`Unsupported prefab transform: ${id}`);
      const sheet = await json(`${effectDirectory}/${effect.spritesheet}`);
      const pages = [];
      for (const page of sheet.pages) pages.push({ file: await publish(`${effectDirectory}/${page.image}`),
        width: page.width, height: page.height });
      manifest.effects[id] = {
        height: { ...await publish(`${effectDirectory}/${effect.heightTemplate.file}`, true),
          min: effect.heightTemplate.heightMin, max: effect.heightTemplate.heightMax,
          pivot: effect.projection.pivotPixels, center: effect.projection.cameraCenterSource,
          pixelsPerCell: effect.projection.pixelsPerCell },
        pages, frames: effect.frames.map(({ page, x, y, width, height, durationMs }) => ({ page, x, y, width, height, durationMs })),
        playback: effect.playback,
      };
    }
  }
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest) + '\n');
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await publishBuildingPortEffects();
  console.log(`Published ${Object.keys(result.views).length} height views and ${Object.keys(result.effects).length} shared effects.`);
}
