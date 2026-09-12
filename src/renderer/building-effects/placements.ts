import type { WorldEntity } from '@/domain/document/world-document';
import type { EntityDefinition } from '@/domain/registry/types/entity-definition';
import { resolveRotatedPortGeometry } from '@/shared/geometry/port';
import type { LogisticsMaterialFrameState } from '@/shared/logistics-material';
import { getRotatedGridFootprint } from '@/shared/geometry/grid';
import type {
  BuildingEffectsManifest,
  BuildingHeightView,
  EffectPlacement,
  RingEffectPlacement,
  SurfacePlacement,
} from './types';
import { rotatePoint } from './height-field';

interface PhysicalPort {
  key: string;
  entityId: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
  direction: string;
  kind: number;
}

export interface EffectScene {
  surfaces: SurfacePlacement[];
  effects: EffectPlacement[];
  ringEffects: RingEffectPlacement[];
  portKeys: Map<string, string>;
  issues: string[];
}

/** 仅按明确模式取绑定；多个允许模式时以 Registry alter-variant 选择，绝不合并。 */
export function selectEffectVariant(view: BuildingHeightView, definition: EntityDefinition): string | undefined {
  const keys = Object.keys(view.variants);
  if (keys.length === 1) return keys[0];
  const mode = definition.tags.find((tag) => tag.startsWith('alter-variant:'))?.slice('alter-variant:'.length);
  const selected = keys.filter((key) => key === `${mode}__0`);
  return selected.length === 1 ? selected[0] : undefined;
}

export function resolveEffectFrame(resource: BuildingEffectsManifest['effects'][string], timeMs: number): number {
  const duration = resource.frames.reduce((sum, frame) => sum + frame.durationMs, 0);
  let remaining = resource.playback.mode === 'loop' && duration > 0
    ? Math.max(0, timeMs) % duration : Math.min(Math.max(0, timeMs), duration);
  for (let index = 0; index < resource.frames.length; index++) {
    remaining -= resource.frames[index]!.durationMs;
    if (remaining < 0) return index;
  }
  return Math.max(0, resource.frames.length - 1);
}

export function selectRingEffectPlacements(
  candidates: readonly RingEffectPlacement[],
  resolveStatus: (entityId: string) => number | undefined,
): RingEffectPlacement[] {
  const statusByEntity = new Map<string, number | undefined>();
  return candidates.filter((candidate) => {
    if (!statusByEntity.has(candidate.entityId)) {
      statusByEntity.set(candidate.entityId, resolveStatus(candidate.entityId));
    }
    return candidate.statusKey === statusByEntity.get(candidate.entityId);
  });
}

export function resolveBuildingEffectScene(options: {
  manifest: BuildingEffectsManifest;
  entities: readonly WorldEntity[];
  definitions: ReadonlyMap<string, EntityDefinition>;
  materials?: LogisticsMaterialFrameState;
  hiddenIds?: ReadonlySet<string>;
  /** 仅接收已确认的原始状态枚举；未知时不猜测显示环和激活覆盖层。 */
  ringStatus?: ReadonlyMap<string, number>;
  activatedIds?: ReadonlySet<string>;
}): EffectScene {
  const result: EffectScene = { surfaces: [], effects: [], ringEffects: [], portKeys: new Map(), issues: [] };
  const physical = new Map<string, PhysicalPort[]>();
  const byEntity = new Map<string, PhysicalPort[]>();
  const entities = options.entities.filter((entity) => !options.hiddenIds?.has(entity.id) && !('originalEntityId' in entity));
  for (const entity of entities) {
    const definition = options.definitions.get(entity.definitionId);
    if (!definition) continue;
    const ports: PhysicalPort[] = [];
    for (const group of definition.portGroups) {
      if (!group.isPipe) continue;
      for (const port of group.ports) {
        const { cell, delta } = resolveRotatedPortGeometry({ footprint: definition.footprint, port, rotation: entity.rotation });
        const entry = { key: `${entity.id}:${group.id}:${port.id}`, entityId: entity.id,
          x: entity.position.x + cell.x + .5 + delta.x * .5, y: entity.position.y + cell.y + .5 + delta.y * .5,
          dx: delta.x, dy: delta.y, direction: group.direction, kind: group.kind };
        ports.push(entry);
        const key = `${entry.x},${entry.y}`;
        const list = physical.get(key) ?? []; list.push(entry); physical.set(key, list);
      }
    }
    byEntity.set(entity.id, ports);
  }
  for (const entity of entities) {
    const definition = options.definitions.get(entity.definitionId);
    if (!definition) continue;
    const material = options.materials?.entities.get(entity.id);
    const viewKey = material ? material.kind === 'pipe' ? 'log_pipe_02_mid/top'
      : `grid_belt_01_${material.shape === 'straight' ? 'mid' : material.shape}/top`
      : options.manifest.definitions[definition.id] ?? `${definition.id}/top`;
    const view = viewKey === undefined ? undefined : options.manifest.views[viewKey];
    if (!view) continue;
    if (view.footprint.width !== definition.footprint.width || view.footprint.height !== definition.footprint.height) {
      result.issues.push(`${definition.id}: footprint differs from height delivery`); continue;
    }
    const size = getRotatedGridFootprint(definition.footprint, entity.rotation);
    const offset = rotatePoint(view.origin[0] - definition.footprint.width / 2,
      view.origin[1] - definition.footprint.height / 2, entity.rotation);
    const originX = entity.position.x + size.width / 2 + offset[0];
    const originY = entity.position.y + size.height / 2 + offset[1];
    const state = material?.kind === 'pipe' ? material.shape === 'straight'
      ? material.support ? 'straightWithSupport' : 'straight' : material.shape : 'default';
    const fieldName = view.stateMapping[state];
    const field = fieldName === null || fieldName === undefined ? undefined : view.fields[fieldName];
    if (field) result.surfaces.push({ id: entity.id, field, x: originX, y: originY,
      rotation: entity.rotation + (material?.rotation ?? 0), baseY: 0 });
    const key = selectEffectVariant(view, definition);
    if (key === undefined) continue;
    for (const port of view.variants[key]!) {
      // 发布清单已将源平面 X/Z 转为项目平面 x/y（project x=X、project y=-Z）；此处只应用实体旋转。
      const [px, py] = rotatePoint(port.position[0], port.position[2], entity.rotation);
      const x = originX + px, y = originY + py;
      const sign = port.role === 'input' ? -1 : 1;
      const [dx, dy] = rotatePoint(sign, 0, entity.rotation + port.yaw);
      const matches = (byEntity.get(entity.id) ?? []).filter((candidate) =>
        Math.abs(candidate.x - x) < .001 && Math.abs(candidate.y - y) < .001
        && Math.abs(candidate.dx - dx) < .001 && Math.abs(candidate.dy - dy) < .001
        && (candidate.direction === port.role || candidate.direction === 'bidirectional'));
      if (matches.length !== 1) {
        result.issues.push(`${definition.id}/${key}/${port.role}:${port.index}: source anchor or direction conflicts with Registry`);
        continue;
      }
      const match = matches[0]!;
      const connected = (physical.get(`${match.x},${match.y}`) ?? []).some((other) =>
        other.entityId !== entity.id && other.dx === -match.dx && other.dy === -match.dy
        && (other.kind & match.kind) !== 0 && (other.direction === 'bidirectional' || other.direction !== port.role));
      const id = `${entity.id}:${key}:${port.role}:${port.index}`;
      const add = (resourceId: string | null, suffix: string) => {
        if (!resourceId || !options.manifest.effects[resourceId]) return;
        result.effects.push({ id: id + suffix, resourceId, x, y, rotation: entity.rotation + port.yaw,
          baseY: port.position[1], epsilon: view.epsilon, ring: false });
        result.portKeys.set(id + suffix, match.key);
      };
      add(port.bindings[connected ? 'on' : 'off'], '');
      if (options.activatedIds?.has(entity.id)) add(port.bindings[connected ? 'activateOn' : 'activateOff'], ':activate');
    }
    const status = options.ringStatus?.get(entity.id);
    const seen = new Set<string>();
    for (const ring of view.rings) {
      if (!options.manifest.effects[ring.resourceId]) continue;
      const signature = JSON.stringify([ring.statusKey, ring.resourceId, ring.position, ring.yaw]);
      if (seen.has(signature)) continue;
      seen.add(signature);
      const [px, py] = rotatePoint(ring.position[0], ring.position[2], entity.rotation);
      const placement: RingEffectPlacement = {
        id: `${entity.id}:ring:${signature}`, entityId: entity.id,
        statusKey: ring.statusKey, resourceId: ring.resourceId,
        x: originX + px, y: originY + py, rotation: entity.rotation + ring.yaw,
        baseY: ring.position[1], epsilon: view.epsilon, ring: true,
      };
      result.ringEffects.push(placement);
      if (ring.statusKey === status) result.effects.push(placement);
    }
  }
  return result;
}
