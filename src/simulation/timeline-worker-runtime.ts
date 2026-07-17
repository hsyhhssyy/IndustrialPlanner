import { SimulationWorkerRuntime } from "./worker-runtime";
import type { SimulationRuntimeExport } from "./types";
import type {
  TimelineWorkerRequest,
  TimelineWorkerResponse,
  TimelineWorkerStatus,
} from "./timeline-worker-protocol";

interface TimelineCheckpoint {
  readonly timelineTickNumber: number;
  readonly runtimeExport: SimulationRuntimeExport;
  readonly presentationSnapshot: SimulationRuntimeExport["snapshot"];
}

// 预测填充与拖动取帧共享同一个 worker 事件循环。真实大型蓝图生成单个检查点
// 需要数毫秒，因此每批只推进少量检查点，及时把控制权还给消息队列。
const TIMELINE_FILL_BATCH_SIZE = 1;
const TIMELINE_FILL_INTERACTION_IDLE_MS = 250;

export class TimelineWorkerRuntime {
  private runtime: SimulationWorkerRuntime | null = null;
  private checkpoints = new Map<number, TimelineCheckpoint>();
  private startTimelineTickNumber: number | null = null;
  private baseStandardTickNumber: number | null = null;
  private capacityTimelineTicks = 600;
  private stepStandardTicks = 10;
  private nextTimelineTickNumber: number | null = null;
  private targetTimelineTickNumber: number | null = null;
  private fillTimerId: ReturnType<typeof setTimeout> | null = null;

  public handleRequest(request: TimelineWorkerRequest): TimelineWorkerResponse {
    switch (request.type) {
      case "load-timeline":
        return {
          type: "timeline-loaded",
          requestId: request.requestId,
          status: this.loadTimeline({
            runtimeExport: request.runtimeExport,
            startTimelineTickNumber: request.startTimelineTickNumber,
            retainedFromTimelineTickNumber: request.retainedFromTimelineTickNumber,
            targetTimelineTickNumber: request.targetTimelineTickNumber,
            capacityTimelineTicks: request.capacityTimelineTicks,
            stepStandardTicks: request.stepStandardTicks,
          }),
        };
      case "retarget-timeline":
        return {
          type: "timeline-retargeted",
          requestId: request.requestId,
          status: this.retargetTimeline({
            retainedFromTimelineTickNumber: request.retainedFromTimelineTickNumber,
            targetTimelineTickNumber: request.targetTimelineTickNumber,
          }),
        };
      case "get-timeline-status":
        return {
          type: "timeline-status",
          requestId: request.requestId,
          status: this.getStatus(),
        };
      case "get-timeline-presentation-frame": {
        this.deferFillForInteraction();
        const timelineTickNumber = Math.max(0, Math.trunc(request.timelineTickNumber));
        const checkpoint = this.checkpoints.get(timelineTickNumber);
        return {
          type: "timeline-presentation-frame-result",
          requestId: request.requestId,
          timelineTickNumber,
          snapshot: checkpoint?.presentationSnapshot ?? null,
          status: this.getStatus(),
        };
      }
      case "get-timeline-presentation-frame-range": {
        this.deferFillForInteraction();
        const fromTimelineTickNumber = Math.max(
          0,
          Math.trunc(request.fromTimelineTickNumber),
        );
        const toTimelineTickNumber = Math.max(
          fromTimelineTickNumber,
          Math.trunc(request.toTimelineTickNumber),
        );
        const frames = [];
        for (
          let timelineTickNumber = fromTimelineTickNumber;
          timelineTickNumber <= toTimelineTickNumber;
          timelineTickNumber += 1
        ) {
          const snapshot = this.checkpoints.get(timelineTickNumber)?.presentationSnapshot;
          if (snapshot !== undefined) {
            frames.push({ timelineTickNumber, snapshot });
          }
        }
        return {
          type: "timeline-presentation-frame-range-result",
          requestId: request.requestId,
          fromTimelineTickNumber,
          toTimelineTickNumber,
          frames,
          status: this.getStatus(),
        };
      }
      case "get-timeline-checkpoint": {
        this.deferFillForInteraction();
        const timelineTickNumber = Math.max(0, Math.trunc(request.timelineTickNumber));
        return {
          type: "timeline-checkpoint-result",
          requestId: request.requestId,
          timelineTickNumber,
          runtimeExport: this.checkpoints.get(timelineTickNumber)?.runtimeExport ?? null,
          status: this.getStatus(),
        };
      }
      case "stop-timeline":
        this.stop();
        return {
          type: "timeline-stopped",
          requestId: request.requestId,
          status: this.getStatus(),
        };
    }
  }

  public stop(): void {
    if (this.fillTimerId !== null) {
      clearTimeout(this.fillTimerId);
      this.fillTimerId = null;
    }
    this.runtime = null;
    this.checkpoints.clear();
    this.startTimelineTickNumber = null;
    this.baseStandardTickNumber = null;
    this.nextTimelineTickNumber = null;
    this.targetTimelineTickNumber = null;
  }

  private loadTimeline(options: {
    readonly runtimeExport: SimulationRuntimeExport;
    readonly startTimelineTickNumber: number;
    readonly retainedFromTimelineTickNumber: number | undefined;
    readonly targetTimelineTickNumber: number | undefined;
    readonly capacityTimelineTicks: number;
    readonly stepStandardTicks: number;
  }): TimelineWorkerStatus {
    if (this.fillTimerId !== null) {
      clearTimeout(this.fillTimerId);
      this.fillTimerId = null;
    }

    const startTimelineTickNumber = Math.max(0, Math.trunc(options.startTimelineTickNumber));
    const capacityTimelineTicks = Math.max(1, Math.trunc(options.capacityTimelineTicks));
    const stepStandardTicks = Math.max(1, Math.trunc(options.stepStandardTicks));
    let retainedFromTimelineTickNumber = options.retainedFromTimelineTickNumber === undefined
      ? startTimelineTickNumber
      : Math.max(0, Math.trunc(options.retainedFromTimelineTickNumber));
    retainedFromTimelineTickNumber = Math.min(retainedFromTimelineTickNumber, startTimelineTickNumber);
    let targetTimelineTickNumber = options.targetTimelineTickNumber === undefined
      ? retainedFromTimelineTickNumber + capacityTimelineTicks - 1
      : Math.max(startTimelineTickNumber, Math.trunc(options.targetTimelineTickNumber));
    if (targetTimelineTickNumber < startTimelineTickNumber) {
      targetTimelineTickNumber = startTimelineTickNumber;
      retainedFromTimelineTickNumber = Math.max(0, targetTimelineTickNumber - capacityTimelineTicks + 1);
    }

    for (const timelineTickNumber of this.checkpoints.keys()) {
      if (
        timelineTickNumber < retainedFromTimelineTickNumber
        || timelineTickNumber > startTimelineTickNumber
      ) {
        this.checkpoints.delete(timelineTickNumber);
      }
    }

    const runtime = new SimulationWorkerRuntime();
    runtime.importRuntimeState(options.runtimeExport, { scheduleBackgroundFill: false });
    const fixedDynamicTickRate = options.runtimeExport.topology.standardTickRate / stepStandardTicks;
    runtime.setFixedDynamicTickRate(fixedDynamicTickRate);

    const baseStandardTickNumber = options.runtimeExport.runtimeState.tickNumber;

    this.runtime = runtime;
    this.startTimelineTickNumber = startTimelineTickNumber;
    this.baseStandardTickNumber = baseStandardTickNumber;
    this.capacityTimelineTicks = Math.max(1, targetTimelineTickNumber - retainedFromTimelineTickNumber + 1);
    this.stepStandardTicks = stepStandardTicks;
    this.nextTimelineTickNumber = startTimelineTickNumber + 1;
    this.targetTimelineTickNumber = targetTimelineTickNumber;
    this.checkpoints.set(startTimelineTickNumber, {
      timelineTickNumber: startTimelineTickNumber,
      runtimeExport: options.runtimeExport,
      presentationSnapshot: createTimelinePresentationSnapshot(options.runtimeExport),
    });
    this.scheduleFill();

    return this.getStatus();
  }

  private retargetTimeline(options: {
    readonly retainedFromTimelineTickNumber: number;
    readonly targetTimelineTickNumber: number;
  }): TimelineWorkerStatus {
    if (this.runtime === null) {
      return this.getStatus();
    }

    const retainedFromTimelineTickNumber = Math.max(
      0,
      Math.trunc(options.retainedFromTimelineTickNumber),
    );
    const targetTimelineTickNumber = Math.max(
      retainedFromTimelineTickNumber,
      Math.trunc(options.targetTimelineTickNumber),
    );

    let deletedFutureCheckpoint = false;
    for (const timelineTickNumber of this.checkpoints.keys()) {
      if (
        timelineTickNumber < retainedFromTimelineTickNumber
        || timelineTickNumber > targetTimelineTickNumber
      ) {
        if (timelineTickNumber > targetTimelineTickNumber) {
          deletedFutureCheckpoint = true;
        }
        this.checkpoints.delete(timelineTickNumber);
      }
    }

    if (
      deletedFutureCheckpoint
      && this.nextTimelineTickNumber !== null
      && this.nextTimelineTickNumber > targetTimelineTickNumber + 1
    ) {
      this.rewindRuntimeToLatestCheckpointAtOrBefore(targetTimelineTickNumber);
    }

    if (
      this.nextTimelineTickNumber === null
      || this.nextTimelineTickNumber < retainedFromTimelineTickNumber
    ) {
      this.nextTimelineTickNumber = retainedFromTimelineTickNumber;
    }
    this.targetTimelineTickNumber = targetTimelineTickNumber;
    this.capacityTimelineTicks = Math.max(
      1,
      targetTimelineTickNumber - retainedFromTimelineTickNumber + 1,
    );
    this.scheduleFill();

    return this.getStatus();
  }

  private rewindRuntimeToLatestCheckpointAtOrBefore(timelineTickNumber: number): void {
    let latestCheckpoint: TimelineCheckpoint | null = null;
    for (const checkpoint of this.checkpoints.values()) {
      if (
        checkpoint.timelineTickNumber <= timelineTickNumber
        && (
          latestCheckpoint === null
          || checkpoint.timelineTickNumber > latestCheckpoint.timelineTickNumber
        )
      ) {
        latestCheckpoint = checkpoint;
      }
    }

    if (latestCheckpoint === null) {
      this.runtime = null;
      this.nextTimelineTickNumber = null;
      return;
    }

    const runtime = new SimulationWorkerRuntime();
    runtime.importRuntimeState(latestCheckpoint.runtimeExport, { scheduleBackgroundFill: false });
    const fixedDynamicTickRate =
      latestCheckpoint.runtimeExport.topology.standardTickRate / this.stepStandardTicks;
    runtime.setFixedDynamicTickRate(fixedDynamicTickRate);

    this.runtime = runtime;
    this.startTimelineTickNumber = latestCheckpoint.timelineTickNumber;
    this.baseStandardTickNumber = latestCheckpoint.runtimeExport.runtimeState.tickNumber;
    this.nextTimelineTickNumber = latestCheckpoint.timelineTickNumber + 1;
  }

  private scheduleFill(delayMs = 0): void {
    if (this.fillTimerId !== null || this.runtime === null) {
      return;
    }
    if (
      this.nextTimelineTickNumber === null
      || this.targetTimelineTickNumber === null
      || this.nextTimelineTickNumber > this.targetTimelineTickNumber
    ) {
      return;
    }

    this.fillTimerId = setTimeout(() => this.fillTimelineTickBatch(), delayMs);
  }

  private deferFillForInteraction(): void {
    if (this.fillTimerId !== null) {
      clearTimeout(this.fillTimerId);
      this.fillTimerId = null;
    }
    this.scheduleFill(TIMELINE_FILL_INTERACTION_IDLE_MS);
  }

  private fillTimelineTickBatch(): void {
    this.fillTimerId = null;

    for (let batchIndex = 0; batchIndex < TIMELINE_FILL_BATCH_SIZE; batchIndex += 1) {
      if (
        this.runtime === null
        || this.startTimelineTickNumber === null
        || this.baseStandardTickNumber === null
        || this.nextTimelineTickNumber === null
        || this.targetTimelineTickNumber === null
        || this.nextTimelineTickNumber > this.targetTimelineTickNumber
      ) {
        break;
      }

      const timelineTickNumber = this.nextTimelineTickNumber;
      const standardTickNumber = this.baseStandardTickNumber
        + (timelineTickNumber - this.startTimelineTickNumber) * this.stepStandardTicks;
      const snapshot = this.runtime.createSparseTickSnapshot(standardTickNumber);
      const runtimeExport = snapshot === null
        ? null
        : this.runtime.exportRuntimeState(standardTickNumber);

      if (runtimeExport !== null) {
        this.checkpoints.set(timelineTickNumber, {
          timelineTickNumber,
          runtimeExport,
          presentationSnapshot: createTimelinePresentationSnapshot(runtimeExport),
        });
      }

      this.nextTimelineTickNumber = timelineTickNumber + 1;
    }

    this.scheduleFill();
  }

  private getStatus(): TimelineWorkerStatus {
    const keys = [...this.checkpoints.keys()].sort((left, right) => left - right);
    return {
      enabled: this.runtime !== null,
      startTimelineTickNumber: this.startTimelineTickNumber,
      availableFromTimelineTickNumber: keys[0] ?? null,
      availableToTimelineTickNumber: keys[keys.length - 1] ?? null,
      capacityTimelineTicks: this.capacityTimelineTicks,
      stepStandardTicks: this.stepStandardTicks,
    };
  }
}

export function createTimelinePresentationSnapshot(
  runtimeExport: SimulationRuntimeExport,
): SimulationRuntimeExport["snapshot"] {
  const devices: SimulationRuntimeExport["snapshot"]["devices"] = {};
  const slots: SimulationRuntimeExport["snapshot"]["slots"] = {};

  for (const device of Object.values(runtimeExport.topology.devices)) {
    if (device.definitionId === "warehouse") {
      continue;
    }

    const deviceSnapshot = runtimeExport.snapshot.devices[device.id];
    if (deviceSnapshot !== undefined) {
      devices[device.id] = deviceSnapshot;
    }
    for (const nodeId of device.nodeIds) {
      const node = runtimeExport.topology.nodes[nodeId];
      if (node === undefined) {
        continue;
      }
      for (const slotId of node.slotIds) {
        const slotSnapshot = runtimeExport.snapshot.slots[slotId];
        if (slotSnapshot !== undefined) {
          slots[slotId] = slotSnapshot;
        }
      }
    }
  }

  return {
    ...runtimeExport.snapshot,
    devices,
    slots,
    nodes: {},
    transfers: [],
    routingCursors: {},
    diagnostics: [],
  };
}
