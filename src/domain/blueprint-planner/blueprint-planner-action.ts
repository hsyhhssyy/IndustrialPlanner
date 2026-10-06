import type { PlannerCapacityReport } from "@/blueprint-planner/capacity-calibration";
import type { BlueprintPlannerRequest, BlueprintPlannerTaskFile, BlueprintPlannerBlueprintInput, BlueprintPlannerBlueprintBoundary, BlueprintPlannerOptions } from "./types/blueprint-planner-types";
import type { BlueprintDocument } from "../document/blueprint-document";

export interface BlueprintPlannerAction {
  inspectBlueprint(blueprint: BlueprintDocument, activeActivityIds: readonly string[], signal?: AbortSignal): Promise<readonly BlueprintPlannerBlueprintBoundary[]>;
  identifyBlueprint(input: BlueprintPlannerBlueprintInput, options: BlueprintPlannerOptions, signal?: AbortSignal): Promise<string>;
  deleteTask(taskId: string): Promise<void>;
  importTask(file: BlueprintPlannerTaskFile): Promise<string>;
  start(request: BlueprintPlannerRequest): string;
  continuePlanning(taskId: string, evaluationsPerRound: number, concurrency?: number | "auto"): void;
  /**
   * 2026-10-06：运行算力基准测试并保存结果。浏览器不暴露 CPU/GPU 占用百分比，
   * 因此先把本机的「并发 → 吞吐」曲线测出来，作为后续调度与 GPU 准入的上限依据。
   */
  calibrateCapacity(request: BlueprintPlannerRequest, confirm: (message: string) => Promise<boolean>,
    onProgress?: (message: string) => void): Promise<PlannerCapacityReport>;
  save(taskId: string): Promise<void>;
  cancel(taskId: string): void;
  retrySave(taskId: string): Promise<void>;
}
