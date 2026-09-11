import { readFile, writeFile } from 'node:fs/promises';
import { createRegistryContract } from '../registry';
import { resolveBuildingEffectScene, selectEffectVariant } from '../renderer/building-effects/placements';
import type { BuildingEffectsManifest } from '../renderer/building-effects/types';
import { resolveRotatedPortGeometry } from '../shared/geometry/port';

const manifest = JSON.parse(await readFile('public/3d-top-view/port-effects/manifest.json', 'utf8')) as BuildingEffectsManifest;
const registry = createRegistryContract();
const definitions = new Map(registry.entityDefinitions.map((definition) => [definition.id, definition]));
const entities = registry.entityDefinitions.map((definition, index) => ({ id: definition.id, definitionId: definition.id,
  position: { x: index * 50, y: 0 }, rotation: 0 as const, config: {}, tags: [] }));
const scene = resolveBuildingEffectScene({ manifest, definitions, entities });
const comparisons = registry.entityDefinitions.flatMap((definition) => {
  const viewKey = manifest.definitions[definition.id] ?? `${definition.id}/top`;
  const view = manifest.views[viewKey];
  if (!view) return [];
  const variant = selectEffectVariant(view, definition);
  if (!variant || view.variants[variant]?.length === 0) return [];
  return [{ entityId: definition.id, view: viewKey, variant,
    sourcePorts: view.variants[variant]!.map(({ role, index, position, yaw }) => ({ role, index, position, yaw })),
    registryPorts: definition.portGroups.filter((group) => group.isPipe).flatMap((group) => group.ports.map((port) => {
      const { cell, delta } = resolveRotatedPortGeometry({ footprint: definition.footprint, port, rotation: 0 });
      return { groupId: group.id, portId: port.id, direction: group.direction,
        sourcePlanePosition: [cell.x + .5 + delta.x * .5 - view.origin[0], cell.y + .5 + delta.y * .5 - view.origin[1]],
        outward: [delta.x, delta.y] };
    })),
  }];
});
const report = { sourceArchive: 'buildings_frontend_v1.5.zip',
  policy: 'Exact Registry anchor, outward direction and input/output role. No inferred reflection or index remapping.',
  heightDefinitionCount: scene.surfaces.length,
  boundEffectCount: scene.effects.length,
  issues: scene.issues, comparisons };
await writeFile('resources/building-port-effects/registry-audit.json', JSON.stringify(report, null, 2) + '\n');
console.log(`${report.heightDefinitionCount} height definitions, ${report.boundEffectCount} bound effects, ${report.issues.length} port conflicts.`);
