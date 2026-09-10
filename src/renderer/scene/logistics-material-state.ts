import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import {
  LOGISTICS_STATIC_ARROW_PHASE,
  resolveLogisticsFluidColor,
  resolveLogisticsMaterialPlacements,
  resolveLogisticsMaterialSpec,
  type LogisticsMaterialEntityState,
  type LogisticsMaterialFrameState,
  type LogisticsMaterialPathEntry,
  type LogisticsMaterialPlacement,
} from "@/shared/logistics-material";

/** 只在文档/仿真快照失效时更新状态；逐渲染帧仅推进两个共享时钟。 */
export class LogisticsMaterialSceneState {
  private documentVersion = -1;
  private simulationVersion = -1;
  private presentationVersion = -1;
  private placements: ReadonlyMap<string, LogisticsMaterialPlacement> = new Map();
  private readonly wet = new Set<string>();
  private readonly colors = new Map<string, string>();
  private lastTick = -1;
  private wasSeeking = false;
  private wasEnabled = false;
  private paused = true;
  private wasStopped = true;
  private hasFluid = false;
  private readonly frame = {
    entities: new Map<string, LogisticsMaterialEntityState>(),
    beltSeconds: LOGISTICS_STATIC_ARROW_PHASE,
    pipeSeconds: 0,
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
      this.frame.pipeSeconds = 0;
    }
    if (topologyChanged) {
      const entries: LogisticsMaterialPathEntry[] = [];
      for (const entity of options.entities) {
        if ("originalEntityId" in entity) continue;
        const definition = options.definitions.get(entity.definitionId);
        if (!definition) continue;
        const spec = resolveLogisticsMaterialSpec(definition.spriteId);
        if (!spec || (!workspace.registry.queries.isBelt(definition.id) && !workspace.registry.queries.isPipe(definition.id))) continue;
        const totalRotation = (entity.rotation + spec.rotation) / 90;
        const entrySide = (totalRotation + 4) % 4;
        const exitSide = (totalRotation + (spec.shape === "straight" ? 2 : spec.shape === "left" ? 3 : 1)) % 4;
        const key = (side: number, reverse: boolean) => {
          const dx = [0, 1, 0, -1][side] ?? 0;
          const dy = [-1, 0, 1, 0][side] ?? 0;
          return `${entity.position.x * 2 + 1 + dx},${entity.position.y * 2 + 1 + dy}:${reverse ? (side + 2) % 4 : side}`;
        };
        entries.push({ ...spec, id: entity.id, input: key(entrySide, false), output: key(exitSide, true) });
      }
      this.placements = resolveLogisticsMaterialPlacements(entries);
      for (const id of this.wet) if (!this.placements.has(id)) this.wet.delete(id);
    }
    if (inputsChanged || reset) {
      const next = new Map<string, LogisticsMaterialEntityState>();
      this.hasFluid = false;
      for (const [id, placement] of this.placements) {
        let color = "empty";
        if (placement.kind === "pipe") {
          const fluidId = simulation?.queries.getPipeFluidItemId(id) ?? null;
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
              this.hasFluid = true;
            }
          }
        }
        const previous = this.frame.entities.get(id);
        next.set(id, previous && previous.color === color && previous.start === placement.start
          && previous.support === placement.support && previous.marker === placement.marker
          && previous.shape === placement.shape && previous.rotation === placement.rotation
          ? previous : { ...placement, color });
      }
      this.frame.entities = next;
    }
    if (enabled && this.wasEnabled && !paused && !this.paused && !reset) {
      const delta = Math.max(0, Number.isFinite(options.deltaMs) ? options.deltaMs / 1000 : 0);
      this.frame.beltSeconds += delta;
      if (this.hasFluid) this.frame.pipeSeconds += delta;
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
