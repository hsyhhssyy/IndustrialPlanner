import type { RuntimeTickSnapshot, SimulationRuntimeExport } from "./types";

export interface TimelineWorkerStatus {
  readonly enabled: boolean;
  readonly startTimelineTickNumber: number | null;
  readonly availableFromTimelineTickNumber: number | null;
  readonly availableToTimelineTickNumber: number | null;
  readonly capacityTimelineTicks: number;
  readonly stepStandardTicks: number;
}

export type TimelineWorkerRequest =
  | {
      readonly type: "load-timeline";
      readonly requestId: number;
      readonly runtimeExport: SimulationRuntimeExport;
      readonly startTimelineTickNumber: number;
      readonly retainedFromTimelineTickNumber?: number;
      readonly targetTimelineTickNumber?: number;
      readonly capacityTimelineTicks: number;
      readonly stepStandardTicks: number;
    }
  | {
      readonly type: "retarget-timeline";
      readonly requestId: number;
      readonly retainedFromTimelineTickNumber: number;
      readonly targetTimelineTickNumber: number;
    }
  | {
      readonly type: "get-timeline-status";
      readonly requestId: number;
    }
  | {
      readonly type: "get-timeline-checkpoint";
      readonly requestId: number;
      readonly timelineTickNumber: number;
    }
  | {
      readonly type: "get-timeline-presentation-frame";
      readonly requestId: number;
      readonly timelineTickNumber: number;
    }
  | {
      /** 批量读取已计算的呈现帧；只返回当前缓存中存在的帧，不等待未来预测。 */
      readonly type: "get-timeline-presentation-frame-range";
      readonly requestId: number;
      readonly fromTimelineTickNumber: number;
      readonly toTimelineTickNumber: number;
    }
  | {
      readonly type: "stop-timeline";
      readonly requestId: number;
    };

export type TimelineWorkerResponse =
  | {
      readonly type: "timeline-loaded";
      readonly requestId: number;
      readonly status: TimelineWorkerStatus;
    }
  | {
      readonly type: "timeline-retargeted";
      readonly requestId: number;
      readonly status: TimelineWorkerStatus;
    }
  | {
      readonly type: "timeline-status";
      readonly requestId: number;
      readonly status: TimelineWorkerStatus;
    }
  | {
      readonly type: "timeline-checkpoint-result";
      readonly requestId: number;
      readonly timelineTickNumber: number;
      readonly runtimeExport: SimulationRuntimeExport | null;
      readonly status: TimelineWorkerStatus;
    }
  | {
      readonly type: "timeline-presentation-frame-result";
      readonly requestId: number;
      readonly timelineTickNumber: number;
      readonly snapshot: RuntimeTickSnapshot | null;
      readonly status: TimelineWorkerStatus;
    }
  | {
      readonly type: "timeline-presentation-frame-range-result";
      readonly requestId: number;
      readonly fromTimelineTickNumber: number;
      readonly toTimelineTickNumber: number;
      readonly frames: readonly TimelinePresentationFrame[];
      readonly status: TimelineWorkerStatus;
    }
  | {
      readonly type: "timeline-stopped";
      readonly requestId: number;
      readonly status: TimelineWorkerStatus;
    };

export interface TimelinePresentationFrame {
  readonly timelineTickNumber: number;
  readonly snapshot: RuntimeTickSnapshot;
}
