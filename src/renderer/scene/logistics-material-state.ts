import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import {
  LOGISTICS_STATIC_ARROW_PHASE,
  resolveLogisticsFluidColor,
  type LogisticsMaterialEntityState,
  type LogisticsMaterialFrameState,
  type LogisticsMaterialRoutePlacement,
} from "@/shared/logistics-material";
import { resolveLogisticsMaterialTopology } from "./logistics-material-topology";

// AI-REMOVED 2026-09-10:
// Reason: 拓扑收集迁至同目录统一处理正式实体、虚影和设备端口。
// Trigger: 支架端点避让和虚影沿线间隔需求。
// Evidence: 原收集循环直接排除了所有 originalEntityId 实体。
// Replacement: logistics-material-topology.ts。
// Risk: Low; Human Review: Required
// Original code (原 shared/logistics-material 导入项):
// resolveLogisticsMaterialPlacements,
// resolveLogisticsMaterialSpec,
// type LogisticsMaterialPathEntry,
// type LogisticsMaterialPlacement,

/** 只在文档/仿真快照失效时更新状态；逐渲染帧仅推进两个共享时钟。 */
/** AI-CORRECTION 2026-09-10: 保留传送带共享时钟；管道改为各运输组独立时钟，空组不推进。 */
export class LogisticsMaterialSceneState {
  private documentVersion = -1;
  private simulationVersion = -1;
  private presentationVersion = -1;
  private placements: ReadonlyMap<string, LogisticsMaterialRoutePlacement> = new Map();
  private committed: ReadonlyMap<string, LogisticsMaterialRoutePlacement> = new Map();
  private previewIds: ReadonlySet<string> = new Set();
  private pipeFlows = new Map<string, { seconds: number; flowing: boolean }>();
  private readonly wet = new Set<string>();
  private readonly colors = new Map<string, string>();
  private lastTick = -1;
  private wasSeeking = false;
  private wasEnabled = false;
  private paused = true;
  private wasStopped = true;
  // AI-REMOVED 2026-09-10:
  // Reason: 全场有流体不能代表每个运输组有流体。
  // Trigger: 空运输锁定组双箭头停止、再次有流体后恢复。
  // Evidence: 原 hasFluid 与 pipeSeconds 驱动全部管道。
  // Replacement: pipeFlows 与实体 pipeFlow。
  // Risk: Low; Human Review: Required
  // Original code:
  // private hasFluid = false;
  private readonly frame = {
    entities: new Map<string, LogisticsMaterialEntityState>(),
    beltSeconds: LOGISTICS_STATIC_ARROW_PHASE,
    // AI-REMOVED 2026-09-10:
    // Reason: 移除全场共享的管道时钟。
    // Trigger: 各运输组独立停动与恢复。
    // Evidence: 原 pipeSeconds 受全场 hasFluid 控制。
    // Replacement: pipeFlows 中各运输组的 seconds。
    // Risk: Low; Human Review: Required
    // Original code:
    // pipeSeconds: 0,
    animationEnabled: false,
  };

  public sync(options: {
    workspace: WorkspaceContract;
    entities: readonly WorldEntity[];
    definitions: ReadonlyMap<string, EntityDefinition>;
    documentVersion: number;
    simulationVersion: number;
    presentationVersion: number;
    deltaMs: number;
  }): LogisticsMaterialFrameState {
    const { workspace } = options;
    const settings = workspace.app?.state.settings;
    const enabled = settings?.gamePlayDeviceAnimations === true && settings.gameUseBlueprintStyleDeviceImages !== true;
    const simulation = workspace.simulation;
    const seeking = simulation?.state.timeline?.isSeeking === true;
    const stopped = simulation?.state.runningState === "stop";
    const paused = simulation?.state.runningState === "pause" || seeking;
    const tick = simulation?.queries.getDocumentRuntimeStatus?.()?.tickNumber ?? -1;
    const topologyChanged = this.documentVersion !== options.documentVersion;
    const inputsChanged = topologyChanged || this.simulationVersion !== options.simulationVersion
      || this.presentationVersion !== options.presentationVersion;
    const reset = tick < this.lastTick || (this.wasSeeking && !seeking)
      || (stopped && !this.wasStopped);
    if (reset) {
      this.wet.clear();
      this.frame.beltSeconds = LOGISTICS_STATIC_ARROW_PHASE;
      // AI-REMOVED 2026-09-10:
      // Reason: 全场管道时钟已移除，重置目标改为各运输组。
      // Trigger: 各运输组独立停动与恢复。
      // Evidence: frame 不再持有 pipeSeconds。
      // Replacement: 下方 pipeFlows 重置循环。
      // Risk: Low; Human Review: Required
      // Original code:
      // this.frame.pipeSeconds = 0;
      for (const flow of this.pipeFlows.values()) flow.seconds = 0;
    }
    if (topologyChanged) {
      // AI-REMOVED 2026-09-10:
      // Reason: 排除虚影的局部收集不能表达设备连接端和虚影连续相位。
      // Trigger: 用户确认的管道支架与双箭头排布规则。
      // Evidence: originalEntityId 分支使虚影始终使用 marker=true 的回退图。
      // Replacement: resolveLogisticsMaterialTopology。
      // Risk: Low; Human Review: Required
      // Original code:
      // const entries: LogisticsMaterialPathEntry[] = [];
      // for (const entity of options.entities) {
      //   if ("originalEntityId" in entity) continue;
      //   const definition = options.definitions.get(entity.definitionId);
      //   if (!definition) continue;
      //   const spec = resolveLogisticsMaterialSpec(definition.spriteId);
      //   if (!spec || (!workspace.registry.queries.isBelt(definition.id) && !workspace.registry.queries.isPipe(definition.id))) continue;
      //   const totalRotation = (entity.rotation + spec.rotation) / 90;
      //   const entrySide = (totalRotation + 4) % 4;
      //   const exitSide = (totalRotation + (spec.shape === "straight" ? 2 : spec.shape === "left" ? 3 : 1)) % 4;
      //   const key = (side: number, reverse: boolean) => {
      //     const dx = [0, 1, 0, -1][side] ?? 0;
      //     const dy = [-1, 0, 1, 0][side] ?? 0;
      //     return `${entity.position.x * 2 + 1 + dx},${entity.position.y * 2 + 1 + dy}:${reverse ? (side + 2) % 4 : side}`;
      //   };
      //   entries.push({ ...spec, id: entity.id, input: key(entrySide, false), output: key(exitSide, true) });
      // }
      // this.placements = resolveLogisticsMaterialPlacements(entries);
      const topology = resolveLogisticsMaterialTopology({
        entities: options.entities, definitions: options.definitions, registry: workspace.registry.queries,
        hiddenEntityIds: new Set(workspace.editor?.state.collections[EntityCollectionType.ghost] ?? []),
        replacingEntityId: workspace.editor?.queries.resolveLogisticsDraftState?.()?.replacingEntityId,
      });
      const flows = new Map<string, { seconds: number; flowing: boolean }>();
      for (const [id, placement] of topology.committed) {
        if (placement.kind !== "pipe" || flows.has(placement.routeId)) continue;
        const previousRoute = this.committed.get(id)?.routeId;
        const previous = previousRoute === undefined ? undefined : this.pipeFlows.get(previousRoute);
        flows.set(placement.routeId, this.pipeFlows.get(placement.routeId) ?? { seconds: previous?.seconds ?? 0, flowing: false });
      }
      this.pipeFlows = flows;
      this.committed = topology.committed;
      this.placements = topology.placements;
      this.previewIds = topology.previewIds;
      for (const id of this.wet) if (!this.placements.has(id)) this.wet.delete(id);
    }
    if (inputsChanged || reset) {
      const next = new Map<string, LogisticsMaterialEntityState>();
      // AI-REMOVED 2026-09-10:
      // Reason: 不再聚合全场流体状态，避免其他运输组驱动空组。
      // Trigger: 空运输组必须停止动画。
      // Evidence: 旧布尔量仅由任意有色管道置为 true。
      // Replacement: 下方按 routeId 查询域锁并更新 flowing。
      // Risk: Low; Human Review: Required
      // Original code:
      // this.hasFluid = false;
      const fluids = new Map<string, string | null>();
      for (const [id, placement] of this.committed) {
        if (placement.kind !== "pipe" || fluids.has(placement.routeId)) continue;
        // 现有查询读取真实运输组域锁；内核在组内最后一个槽排空时清除此值。
        const fluidId = simulation?.queries.getPipeFluidItemId(id) ?? null;
        fluids.set(placement.routeId, fluidId);
        this.pipeFlows.get(placement.routeId)!.flowing = fluidId !== null;
      }
      for (const [id, placement] of this.placements) {
        let color = "empty";
        const preview = this.previewIds.has(id) ? true : undefined;
        const routeId = this.committed.get(id)?.routeId;
        const pipeFlow = preview || routeId === undefined ? undefined : this.pipeFlows.get(routeId);
        if (placement.kind === "pipe") {
          const fluidId = preview || routeId === undefined ? null : fluids.get(routeId) ?? null;
          if (fluidId === null) this.wet.delete(id);
          else {
            const occupied = this.wet.has(id) && settings?.gameShowPipeExactFluidPosition !== true
              ? true : simulation?.queries.isPipeDeviceSlotOccupied(id) === true;
            if (occupied) this.wet.add(id);
            if (settings?.gameShowPipeExactFluidPosition ? occupied : this.wet.has(id)) {
              let resolved = this.colors.get(fluidId);
              if (resolved === undefined) {
                resolved = resolveLogisticsFluidColor(workspace.registry.queries.findItemDefinition(fluidId)?.tags ?? []);
                this.colors.set(fluidId, resolved);
              }
              color = resolved;
              // AI-REMOVED 2026-09-10:
              // Reason: 染色不再驱动全场动画。
              // Trigger: 空运输组必须停止动画。
              // Evidence: 一个有色管道会把其他空组的时钟一起推进。
              // Replacement: 上方按运输组域锁更新 flowing。
              // Risk: Low; Human Review: Required
              // Original code:
              // this.hasFluid = true;
            }
          }
        }
        const previous = this.frame.entities.get(id);
        next.set(id, previous && previous.color === color && previous.start === placement.start
          && previous.support === placement.support && previous.marker === placement.marker
          && previous.shape === placement.shape && previous.rotation === placement.rotation
          && previous.preview === preview && previous.pipeFlow === pipeFlow
          ? previous : { ...placement, color, preview, pipeFlow });
      }
      this.frame.entities = next;
    }
    if (enabled && this.wasEnabled && !paused && !this.paused && !reset) {
      const delta = Math.max(0, Number.isFinite(options.deltaMs) ? options.deltaMs / 1000 : 0);
      this.frame.beltSeconds += delta;
      // AI-REMOVED 2026-09-10:
      // Reason: 移除全场流体驱动的共享时钟推进。
      // Trigger: 各运输组独立停动与恢复。
      // Evidence: hasFluid 与 frame.pipeSeconds 已由运输组状态替代。
      // Replacement: 下方只推进 flowing 运输组的循环。
      // Risk: Low; Human Review: Required
      // Original code:
      // if (this.hasFluid) this.frame.pipeSeconds += delta;
      for (const flow of this.pipeFlows.values()) if (flow.flowing) flow.seconds += delta;
    }
    this.frame.animationEnabled = enabled;
    this.wasEnabled = enabled;
    this.wasSeeking = seeking;
    this.paused = paused;
    this.wasStopped = stopped;
    this.lastTick = tick;
    this.documentVersion = options.documentVersion;
    this.simulationVersion = options.simulationVersion;
    this.presentationVersion = options.presentationVersion;
    return this.frame;
  }
}
