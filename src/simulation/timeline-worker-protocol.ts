import type { SimulationRuntimeExport } from "./types";

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
      readonly capacityTimelineTicks: number;
      readonly stepStandardTicks: number;
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
      readonly type: "timeline-stopped";
      readonly requestId: number;
      readonly status: TimelineWorkerStatus;
    };
