import type { WorldEntity } from '@/domain/document/world-document';
import type { EntityDefinition } from '@/domain/registry/types/entity-definition';
import { resolveRotatedPortGeometry } from '@/shared/geometry/port';
import type { LogisticsMaterialFrameState } from '@/shared/logistics-material';
import { getRotatedGridFootprint } from '@/shared/geometry/grid';
// AI-REMOVED 2026-09-25:
// Reason: 端口 on/off 特效不再按暗管类型选择流体播放门控。
// Trigger: 用户明确要求未接管道的 off 与已接管道的 on 始终播放。
// Evidence: 特效清单中两种资源均为 loop；原门控使 off 必定停在静态帧。
// Replacement: resolveBuildingEffectScene 只按连接状态选择资源，BuildingEffectsScene.sync 使用场景时钟。
// Risk: Low；空管和断开端口也持续播放。
// Human Review: Required
//
// Original code:
// import { isDarkPipeDefinitionId } from '@/shared/dark-pipe-link';
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
  const mode = definition.tags.find((tag) => tag.startsWith('alter-variant:'))?.slice('alter-variant:'.length);
  // AI-CORRECTION 2026-09-18: 有 alter-variant 的实体必须精确命中对应模板；新版素材只交付另一模式时不得复用唯一变体。
  if (mode === undefined) return keys.length === 1 ? keys[0] : undefined;
  const selected = keys.filter((key) => key === `${mode}__0`);
  return selected.length === 1 ? selected[0] : undefined;
}

export function resolveEffectFrame(resource: BuildingEffectsManifest['effects'][string], timeMs: number): number {
  // AI-REMOVED 2026-09-25:
  // Reason: 所有端口特效都使用持续推进的场景时钟，null 静态帧路径已不可达。
  // Trigger: 用户明确要求 on/off 在连接和断开状态下始终播放。
  // Evidence: 唯一运行时调用方 BuildingEffectsScene.sync 现直接传入 nowMs。
  // Replacement: 下方按 timeMs 解析动画帧。
  // Risk: Low；保留 manifest.staticFrame 仅供素材数据契约使用。
  // Human Review: Required
  //
  // Original code:
  // if (timeMs === null) {
  //   return Math.min(Math.max(0, resource.playback.staticFrame), Math.max(0, resource.frames.length - 1));
  // }
  const duration = resource.frames.reduce((sum, frame) => sum + frame.durationMs, 0);
  let remaining = resource.playback.mode === 'loop' && duration > 0
    ? Math.max(0, timeMs) % duration : Math.min(Math.max(0, timeMs), duration);
  for (let index = 0; index < resource.frames.length; index++) {
    remaining -= resource.frames[index]!.durationMs;
    if (remaining < 0) return index;
  }
  return Math.max(0, resource.frames.length - 1);
}

// AI-REMOVED 2026-09-25:
// Reason: 流体占用与运输组时钟不能再决定端口 on/off 特效是否播放。
// Trigger: 用户明确要求 on/off 两种特效始终播放。
// Evidence: 未接管道时 animationFluidEntityId 为 null，旧函数必定返回 null。
// Replacement: BuildingEffectsScene.sync 直接传入 options.nowMs 给 resolveEffectFrame。
// Risk: Low；动画相位从运输组时钟改为场景时钟。
// Human Review: Required
//
// Original code:
// export function resolveEffectPlaybackTimeMs(
//   effect: Pick<EffectPlacement, 'animationFluidEntityId'>,
//   materials: LogisticsMaterialFrameState | undefined,
//   nowMs: number,
// ): number | null {
//   if (effect.animationFluidEntityId === undefined) return nowMs;
//   if (effect.animationFluidEntityId === null) return null;
//   const fluidState = materials?.entities.get(effect.animationFluidEntityId);
//   return fluidState === undefined || fluidState.fluidItemId === null
//     ? null
//     : (fluidState.pipeFlow?.seconds ?? 0) * 1000;
// }

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
      const connectedPort = (physical.get(`${match.x},${match.y}`) ?? []).find((other) =>
        other.entityId !== entity.id && other.dx === -match.dx && other.dy === -match.dy
        && (other.kind & match.kind) !== 0 && (other.direction === 'bidirectional' || other.direction !== port.role));
      const connected = connectedPort !== undefined;
      // AI-REMOVED 2026-09-25:
      // Reason: 相邻管道 ID 仅服务旧流体门控，端口特效现在统一按场景时钟播放。
      // Trigger: 用户明确要求断开的 off 与连接的 on 都持续播放。
      // Evidence: 连接状态已由 connected 决定素材绑定，不需要流体实体 ID。
      // Replacement: 下方 add 只保存资源与位置；连接状态仍用于选择 on/off。
      // Risk: Low；不再与管道流体相位同步。
      // Human Review: Required
      //
      // Original code:
      // const animationFluidEntityId = isDarkPipeDefinitionId(definition.id)
      //   ? connectedPort?.entityId ?? null
      //   : undefined;
      const id = `${entity.id}:${key}:${port.role}:${port.index}`;
      const add = (resourceId: string | null, suffix: string) => {
        if (!resourceId || !options.manifest.effects[resourceId]) return;
        // AI-REMOVED 2026-09-25:
        // Reason: 特效放置项不再保存流体播放门控字段。
        // Trigger: 用户要求端口 on/off 特效始终播放。
        // Evidence: BuildingEffectsScene.sync 已统一使用场景时钟。
        // Replacement: 下方不含 animationFluidEntityId 的放置项。
        // Risk: Low。
        // Human Review: Required
        //
        // Original code:
        // result.effects.push({ id: id + suffix, resourceId, animationFluidEntityId,
        result.effects.push({ id: id + suffix, resourceId,
          x, y, rotation: entity.rotation + port.yaw,
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
