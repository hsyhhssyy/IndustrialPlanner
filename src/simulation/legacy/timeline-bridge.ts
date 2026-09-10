import type { SimulationHostWorkerMode } from "../contracts";

import type { WorkspaceContract } from "@/domain/document/workspace-contract";

import { type TimelineWorkerBridge } from "./bridge-contract";

import type { TimelineWorkerRequest, TimelineWorkerResponse } from "./timeline-worker-protocol";
import { TimelineWorkerRuntime } from "./timeline-worker-runtime";

import {
  attachWorkerRuntime,
  type WorkerRuntimeAttachment,
} from "@/shared/worker/attach-worker-runtime";

export function createTimelineWorkerBridge(
  workerMode: SimulationHostWorkerMode,
  registry: WorkspaceContract["registry"],
): TimelineWorkerBridge {
  if (workerMode === "auto" && typeof Worker === "function") {
    return new BrowserTimelineWorkerBridge();
  }

  return new LocalTimelineWorkerBridge(registry);
}

class BrowserTimelineWorkerBridge implements TimelineWorkerBridge {
  private readonly worker: Worker;
  private readonly runtimeAttachment: WorkerRuntimeAttachment;
  private nextRequestId = 1;
  private readonly pending = new Map<
    number,
    {
      resolve: (response: TimelineWorkerResponse) => void;
      reject: (error: Error) => void;
    }
  >();

  public constructor() {
    this.worker = new Worker(new URL("../timeline-worker.ts", import.meta.url), {
      type: "module",
    });
    this.runtimeAttachment = attachWorkerRuntime(this.worker, "timeline", {
      onFault: (fault) => {
        this.rejectAll(new Error(`Timeline worker failed: ${fault.message}`));
      },
    });
    this.worker.addEventListener("message", (event: MessageEvent<TimelineWorkerResponse>) => {
      const handlers = this.pending.get(event.data.requestId);
      if (handlers === undefined) {
        return;
      }

      this.pending.delete(event.data.requestId);
      handlers.resolve(event.data);
    });
    this.worker.addEventListener("error", (event) => {
      const message = event.message || "Unknown timeline worker error";
      console.error("[TimelineWorker] startup or uncaught worker error", message);
      this.rejectAll(new Error(`Timeline worker crashed: ${message}`));
    });
  }

  public loadTimeline(options: Parameters<TimelineWorkerBridge["loadTimeline"]>[0]): Promise<Extract<
    TimelineWorkerResponse,
    { readonly type: "timeline-loaded" }
  >> {
    return this.request({
      type: "load-timeline",
      requestId: this.createRequestId(),
      ...options,
    }, "timeline-loaded");
  }

  public getTimelineStatus(): Promise<Extract<
    TimelineWorkerResponse,
    { readonly type: "timeline-status" }
  >> {
    return this.request({
      type: "get-timeline-status",
      requestId: this.createRequestId(),
    }, "timeline-status");
  }

  public retargetTimeline(options: Parameters<TimelineWorkerBridge["retargetTimeline"]>[0]): Promise<Extract<
    TimelineWorkerResponse,
    { readonly type: "timeline-retargeted" }
  >> {
    return this.request({
      type: "retarget-timeline",
      requestId: this.createRequestId(),
      ...options,
    }, "timeline-retargeted");
  }

  public getTimelineCheckpoint(timelineTickNumber: number): Promise<Extract<
    TimelineWorkerResponse,
    { readonly type: "timeline-checkpoint-result" }
  >> {
    return this.request({
      type: "get-timeline-checkpoint",
      requestId: this.createRequestId(),
      timelineTickNumber,
    }, "timeline-checkpoint-result");
  }

  public getTimelinePresentationFrame(timelineTickNumber: number): Promise<Extract<
    TimelineWorkerResponse,
    { readonly type: "timeline-presentation-frame-result" }
  >> {
    return this.request({
      type: "get-timeline-presentation-frame",
      requestId: this.createRequestId(),
      timelineTickNumber,
    }, "timeline-presentation-frame-result");
  }

  public getTimelinePresentationFrameRange(fromTimelineTickNumber: number, toTimelineTickNumber: number): Promise<Extract<
    TimelineWorkerResponse,
    { readonly type: "timeline-presentation-frame-range-result" }
  >> {
    return this.request({
      type: "get-timeline-presentation-frame-range",
      requestId: this.createRequestId(),
      fromTimelineTickNumber,
      toTimelineTickNumber,
    }, "timeline-presentation-frame-range-result");
  }

  public stopTimeline(): Promise<Extract<
    TimelineWorkerResponse,
    { readonly type: "timeline-stopped" }
  >> {
    return this.request({
      type: "stop-timeline",
      requestId: this.createRequestId(),
    }, "timeline-stopped");
  }

  public dispose(): void {
    const error = new Error("Timeline worker disposed");
    this.rejectAll(error);
    this.runtimeAttachment.dispose();
    this.worker.terminate();
  }

  private rejectAll(error: Error): void {
    for (const handlers of this.pending.values()) {
      handlers.reject(error);
    }
    this.pending.clear();
  }

  private request<TType extends TimelineWorkerResponse["type"]>(
    request: TimelineWorkerRequest,
    expectedType: TType,
  ): Promise<Extract<TimelineWorkerResponse, { readonly type: TType }>> {
    return new Promise((resolve, reject) => {
      this.pending.set(request.requestId, {
        resolve: (response) => {
          if (response.type !== expectedType) {
            reject(new Error(`Unexpected timeline worker response "${response.type}".`));
            return;
          }
          resolve(response as Extract<TimelineWorkerResponse, { readonly type: TType }>);
        },
        reject,
      });
      this.worker.postMessage(request);
    });
  }

  private createRequestId(): number {
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return requestId;
  }
}

class LocalTimelineWorkerBridge implements TimelineWorkerBridge {
  private readonly runtime: TimelineWorkerRuntime;
  private nextRequestId = 1;

  public constructor(registry: WorkspaceContract["registry"]) {
    this.runtime = new TimelineWorkerRuntime(registry);
  }

  public loadTimeline(options: Parameters<TimelineWorkerBridge["loadTimeline"]>[0]): Promise<Extract<
    TimelineWorkerResponse,
    { readonly type: "timeline-loaded" }
  >> {
    const response = this.runtime.handleRequest({
      type: "load-timeline",
      requestId: this.createRequestId(),
      ...options,
    });
    if (response.type !== "timeline-loaded") {
      throw new Error(`Unexpected timeline worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public getTimelineStatus(): Promise<Extract<
    TimelineWorkerResponse,
    { readonly type: "timeline-status" }
  >> {
    const response = this.runtime.handleRequest({
      type: "get-timeline-status",
      requestId: this.createRequestId(),
    });
    if (response.type !== "timeline-status") {
      throw new Error(`Unexpected timeline worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public retargetTimeline(options: Parameters<TimelineWorkerBridge["retargetTimeline"]>[0]): Promise<Extract<
    TimelineWorkerResponse,
    { readonly type: "timeline-retargeted" }
  >> {
    const response = this.runtime.handleRequest({
      type: "retarget-timeline",
      requestId: this.createRequestId(),
      ...options,
    });
    if (response.type !== "timeline-retargeted") {
      throw new Error(`Unexpected timeline worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public getTimelineCheckpoint(timelineTickNumber: number): Promise<Extract<
    TimelineWorkerResponse,
    { readonly type: "timeline-checkpoint-result" }
  >> {
    const response = this.runtime.handleRequest({
      type: "get-timeline-checkpoint",
      requestId: this.createRequestId(),
      timelineTickNumber,
    });
    if (response.type !== "timeline-checkpoint-result") {
      throw new Error(`Unexpected timeline worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public getTimelinePresentationFrame(timelineTickNumber: number): Promise<Extract<
    TimelineWorkerResponse,
    { readonly type: "timeline-presentation-frame-result" }
  >> {
    const response = this.runtime.handleRequest({
      type: "get-timeline-presentation-frame",
      requestId: this.createRequestId(),
      timelineTickNumber,
    });
    if (response.type !== "timeline-presentation-frame-result") {
      throw new Error(`Unexpected timeline worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public getTimelinePresentationFrameRange(fromTimelineTickNumber: number, toTimelineTickNumber: number): Promise<Extract<
    TimelineWorkerResponse,
    { readonly type: "timeline-presentation-frame-range-result" }
  >> {
    const response = this.runtime.handleRequest({
      type: "get-timeline-presentation-frame-range",
      requestId: this.createRequestId(),
      fromTimelineTickNumber,
      toTimelineTickNumber,
    });
    if (response.type !== "timeline-presentation-frame-range-result") {
      throw new Error(`Unexpected timeline worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public stopTimeline(): Promise<Extract<
    TimelineWorkerResponse,
    { readonly type: "timeline-stopped" }
  >> {
    const response = this.runtime.handleRequest({
      type: "stop-timeline",
      requestId: this.createRequestId(),
    });
    if (response.type !== "timeline-stopped") {
      throw new Error(`Unexpected timeline worker response "${response.type}".`);
    }
    return Promise.resolve(response);
  }

  public dispose(): void {
    this.runtime.stop();
  }

  private createRequestId(): number {
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return requestId;
  }
}
