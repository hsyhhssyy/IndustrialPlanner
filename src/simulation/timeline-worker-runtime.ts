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
}

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
            capacityTimelineTicks: request.capacityTimelineTicks,
            stepStandardTicks: request.stepStandardTicks,
          }),
        };
      case "get-timeline-status":
        return {
          type: "timeline-status",
          requestId: request.requestId,
          status: this.getStatus(),
        };
      case "get-timeline-checkpoint": {
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
    let targetTimelineTickNumber = retainedFromTimelineTickNumber + capacityTimelineTicks - 1;
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
    this.capacityTimelineTicks = capacityTimelineTicks;
    this.stepStandardTicks = stepStandardTicks;
    this.nextTimelineTickNumber = startTimelineTickNumber + 1;
    this.targetTimelineTickNumber = targetTimelineTickNumber;
    this.checkpoints.set(startTimelineTickNumber, {
      timelineTickNumber: startTimelineTickNumber,
      runtimeExport: options.runtimeExport,
    });
    this.scheduleFill();

    return this.getStatus();
  }

  private scheduleFill(): void {
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

    this.fillTimerId = setTimeout(() => this.fillOneTimelineTick(), 0);
  }

  private fillOneTimelineTick(): void {
    this.fillTimerId = null;

    if (
      this.runtime === null
      || this.startTimelineTickNumber === null
      || this.baseStandardTickNumber === null
      || this.nextTimelineTickNumber === null
      || this.targetTimelineTickNumber === null
    ) {
      return;
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
      });
    }

    this.nextTimelineTickNumber = timelineTickNumber + 1;
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
