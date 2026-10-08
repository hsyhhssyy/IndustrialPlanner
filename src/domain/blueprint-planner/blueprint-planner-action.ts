import type { BlueprintPlannerRequest, BlueprintPlannerTaskFile, BlueprintPlannerBlueprintInput, BlueprintPlannerBlueprintBoundary, BlueprintPlannerOptions } from "./types/blueprint-planner-types";
import type { BlueprintDocument } from "../document/blueprint-document";

export interface BlueprintPlannerAction {
  inspectBlueprint(blueprint: BlueprintDocument, activeActivityIds: readonly string[], signal?: AbortSignal): Promise<readonly BlueprintPlannerBlueprintBoundary[]>;
  // AI-REMOVED 2026-10-07:
  // Reason: 识别操作改为继续已有任务，识别前即可保存和导出。
  // Trigger: 用户要求部分识别任务可下载、导入和恢复。
  // Evidence: 原签名只在识别成功后返回新任务编号。
  // Replacement: createBlueprintTask、updateBlueprintBoundaries、identifyBlueprint(taskId)。
  // Risk: 调用方须同步升级；Human Review: Required
  // Original code:
  // identifyBlueprint(input: BlueprintPlannerBlueprintInput, options: BlueprintPlannerOptions, signal?: AbortSignal): Promise<string>;
  createBlueprintTask(input: BlueprintPlannerBlueprintInput, options: BlueprintPlannerOptions): Promise<string>;
  updateBlueprintBoundaries(taskId: string, boundaries: readonly BlueprintPlannerBlueprintBoundary[]): Promise<void>;
  identifyBlueprint(taskId: string, signal?: AbortSignal): Promise<void>;
  deleteTask(taskId: string): Promise<void>;
  importTask(file: BlueprintPlannerTaskFile): Promise<string>;
  start(request: BlueprintPlannerRequest): string;
  continuePlanning(taskId: string, evaluationsPerRound: number, concurrency?: number | "auto", gpu?: boolean): void;
  save(taskId: string): Promise<void>;
  cancel(taskId: string): void;
  retrySave(taskId: string): Promise<void>;
}
