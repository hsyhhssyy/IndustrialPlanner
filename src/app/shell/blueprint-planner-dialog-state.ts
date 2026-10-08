import { isBlueprintRecognitionRequest } from "@/shared/planner-task";
import { makeAutoObservable, observable, toJS } from "mobx";
import type { BlueprintPlannerContract, BlueprintPlannerItemPolicy, BlueprintPlannerOptions, BlueprintPlannerProductionPlan, BlueprintPlannerRequest, BlueprintPlannerSupplyPolicy, BlueprintPlannerTaskRequest } from "@/domain/blueprint-planner";
import { readFromLocalStorage, saveToLocalStorage } from "@/shared/storage";
import { runStorageEffect } from "@/shared/storage/storage-failure";
import { createDefaultDialogStateForKey } from "../state";
import type { BlueprintDocument } from "@/domain/document/blueprint-document";

const ENABLED_KEY = "industrial-planner.experimental.eda";
// AI-REMOVED 2026-10-06:
// Reason: 新任务不再持久化或继承全局规划选项。
// Trigger: 用户要求新任务恢复默认选项。
// Evidence: 原控制器读取并继承上次保存值。
// Replacement: createDefaultPlannerOptions
// Risk: Low；旧任务仍通过 selectTask 恢复自己的参数。
// Human Review: Required
// Original code:
// const OPTIONS_KEY = "industrial-planner.eda.options";

function createDefaultPlannerOptions(): BlueprintPlannerOptions {
  return {
    solidSupply: "warehouse", fluidSupply: "conduit", warehouseBus: "straight",
    solidOutput: "auto", byproducts: "destroy", plantStartup: "preload", converterStartup: "reject", evaluationsPerRound: 5_000_000, concurrency: "auto", gpu: true,
    itemPolicies: [],
  };
}

export class BlueprintPlannerDialogController {
  readonly dialogState = createDefaultDialogStateForKey("blueprint-planner");
  enabled = readFromLocalStorage<boolean>(ENABLED_KEY) === true;
  plan: BlueprintPlannerProductionPlan | null = null;
  blueprintDraft: BlueprintDocument | null = null;
  blueprintRequest: BlueprintPlannerRequest | null = null;
  viewTaskId: string | null = null;
  options: BlueprintPlannerOptions = createDefaultPlannerOptions();
  blueprintCreationError: string | null = null;

  constructor(private readonly getPlanner: () => BlueprintPlannerContract | null) {
// AI-REMOVED 2026-10-06:
// Reason: 新任务必须使用统一默认值，取消全局选项恢复。
// Trigger: 用户要求新任务恢复默认选项。
// Evidence: 原控制器读取并继承上次保存值。
// Replacement: createDefaultPlannerOptions
// Risk: Low；旧任务仍通过 selectTask 恢复自己的参数。
// Human Review: Required
// Original code:
//     const saved = readFromLocalStorage<Partial<BlueprintPlannerOptions>>(OPTIONS_KEY);
//     if (saved !== null) {
//       if (saved.converterStartup !== undefined && ["manual", "tank", "reject"].includes(saved.converterStartup)) {
//         this.options = { ...this.options, converterStartup: saved.converterStartup };
//       }
//       for (const key of ["solidSupply", "fluidSupply", "warehouseBus", "solidOutput", "byproducts", "plantStartup"] as const) {
//         const choices = {
//           solidSupply: ["external", "warehouse"], fluidSupply: ["external", "conduit"], warehouseBus: ["straight", "corner", "u-shaped"],
//           solidOutput: ["warehouse", "stash", "auto"], byproducts: ["destroy", "output"], plantStartup: ["preload", "warehouse"],
//         };
//         const value = key === "warehouseBus" && (saved[key] as string) === "free" ? "corner" : saved[key];
//         if (value !== undefined && choices[key].includes(value)) this.options = { ...this.options, [key]: value };
//       }
//       // AI-REMOVED 2026-09-30:
//       // Reason: 改为提案预算与真实累计计数，预览保留任务窗口。
//       // Trigger: 用户批准本轮接口与交互调整。
//       // Evidence: 原实现使用时间截止或关闭任务面板。
//       // Replacement: src/app/shell/blueprint-planner-dialog-state.ts
//       // Risk: Low。Human Review: Required
//       // Original code:
//       //       if (typeof saved.budgetMs === "number" && Number.isFinite(saved.budgetMs) && saved.budgetMs > 0) this.options = { ...this.options, budgetMs: saved.budgetMs };
//
//       if (typeof saved.evaluationsPerRound === "number" && Number.isSafeInteger(saved.evaluationsPerRound)
//         && saved.evaluationsPerRound >= 10_000 && saved.evaluationsPerRound % 10_000 === 0) {
//         this.options = { ...this.options, evaluationsPerRound: saved.evaluationsPerRound };
//       }
//       // AI-REMOVED 2026-10-03:
//       // Reason: 浏览器并发统一自动调节，旧手填值不能限制恢复后的自动模式。
//       // Trigger: 用户授权取消手填并发。Evidence: 默认选项及继续规划改用 auto。
//       // Replacement: options.concurrency = "auto"。Risk: Low。Human Review: Required
//       // Original code:
//       // if (typeof saved.concurrency === "number" && Number.isSafeInteger(saved.concurrency)
//       //   && saved.concurrency >= 1 && saved.concurrency <= 32) this.options = { ...this.options, concurrency: saved.concurrency };
//       // AI-CORRECTION 2026-10-03：复选框关闭保存为 1；旧多 Worker 数字仍迁移为自动。
//       if (saved.concurrency === 1) this.options = { ...this.options, concurrency: 1 };
//     }
    makeAutoObservable<BlueprintPlannerDialogController, "getPlanner">(this, {
      plan: observable.ref, blueprintDraft: observable.ref, blueprintRequest: observable.ref, getPlanner: false,
    }, { autoBind: true });
  }

  get activeTaskId(): string | null { return this.getPlanner()?.state.activeTaskId ?? null; }
  get taskLocked(): boolean { return this.activeTaskId !== null; }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    runStorageEffect("planner-enabled", () => saveToLocalStorage(ENABLED_KEY, enabled));
    if (!enabled) this.close();
  }

  open(plan?: BlueprintPlannerProductionPlan): void {
    const activeTaskId = this.activeTaskId;
    if (activeTaskId !== null) {
      this.selectTask(activeTaskId, this.getPlanner()?.queries.getLastRequest(activeTaskId) ?? undefined);
      this.dialogState.visible = true;
      return;
    }
    if (plan !== undefined) {
      this.blueprintDraft = null; this.blueprintRequest = null;
      this.plan = { ...structuredClone(plan), supplyPolicies: [] }; this.viewTaskId = null;
      this.options = createDefaultPlannerOptions();
    }
    this.dialogState.visible = true;
  }

// AI-REMOVED 2026-10-07:
// Reason: 打开原图即建立持久任务，识别请求不要求生产计划。
// Trigger: 用户要求识别任务可恢复、自动识别出口与预览联动。
// Evidence: 原实现只在识别成功后建任务，边界必须全部手动补齐。
// Replacement: src/app/shell/blueprint-planner-dialog-state.ts openBlueprint/selectTask
// Risk: 已保存规划任务保留原有格式和验收；Human Review: Required
// Original code:
//   openBlueprint(blueprint: BlueprintDocument): void {
//     if (this.taskLocked) { this.open(); return; }
//     this.options = createDefaultPlannerOptions();
//     this.blueprintDraft = structuredClone(toJS(blueprint));
//     this.blueprintRequest = null; this.plan = null; this.viewTaskId = null;
//     this.dialogState.visible = true;
//   }
//
//   selectTask(taskId: string | null, request?: BlueprintPlannerRequest): void {
//     if (this.taskLocked && taskId !== this.activeTaskId) return;
//     this.viewTaskId = taskId;
//     this.blueprintDraft = null;
//     this.blueprintRequest = request?.blueprintSource ? structuredClone(request) : null;
//     if (taskId === null || !request) this.plan = null;
//     if (request) { this.plan = structuredClone(request.plan); this.options = {
//       ...structuredClone(request.options), converterStartup: request.options.converterStartup ?? "reject", concurrency: request.options.concurrency === 1 ? 1 : "auto",
//       gpu: request.options.gpu ?? request.options.concurrency === "auto",
//     }; }
//   }
//
  openBlueprint(blueprint: BlueprintDocument, activeActivityIds: readonly string[] = []): void {
    if (this.taskLocked) { this.open(); return; }
    this.options = createDefaultPlannerOptions();
    const draft = structuredClone(toJS(blueprint));
    this.blueprintDraft = draft; this.blueprintCreationError = null;
    this.blueprintRequest = null; this.plan = null; this.viewTaskId = null;
    this.dialogState.visible = true;
    const planner = this.getPlanner();
    if (!planner) { this.blueprintCreationError = "蓝图规划服务不可用。"; return; }
    void planner.actions.createBlueprintTask({ blueprint: draft, boundaries: [],
      activeActivityIds }, toJS(this.options)).then(id => {
      if (this.blueprintDraft === draft && this.viewTaskId === null) this.selectTask(id, planner.queries.getLastRequest(id) ?? undefined);
    }).catch(error => { this.blueprintCreationError = error instanceof Error ? error.message : String(error); });
  }

  selectTask(taskId: string | null, request?: BlueprintPlannerTaskRequest): void {
    if (this.taskLocked && taskId !== this.activeTaskId) return;
    this.viewTaskId = taskId; this.blueprintCreationError = null;
    const recognizing = request && isBlueprintRecognitionRequest(request);
    this.blueprintDraft = recognizing ? structuredClone(request.input.blueprint) : null;
    this.blueprintRequest = request && !recognizing && request.blueprintSource ? structuredClone(request) : null;
    this.plan = request && !recognizing ? structuredClone(request.plan) : null;
    if (request) this.options = {
      ...structuredClone(request.options), converterStartup: request.options.converterStartup ?? "reject", concurrency: request.options.concurrency === 1 ? 1 : "auto",
      gpu: request.options.gpu ?? request.options.concurrency === "auto",
    };
  }

  close(): void { this.dialogState.visible = false; }
  toggleMaximized(): void { this.dialogState.maximized = !this.dialogState.maximized; }
  setOffset(offsetX: number, offsetY: number): void { this.dialogState.offsetX = offsetX; this.dialogState.offsetY = offsetY; }
  setSize(width: number, height: number): void { this.dialogState.width = width; this.dialogState.height = height; }

  updateOptions(options: Partial<BlueprintPlannerOptions>): void {
    this.options = { ...this.options, ...options,
      concurrency: (options.concurrency ?? this.options.concurrency) === 1 ? 1 : "auto" };
// AI-REMOVED 2026-10-06:
// Reason: 选项归属当前任务，不再持久化为后续新任务的默认值。
// Trigger: 用户要求新任务恢复默认选项。
// Evidence: 原控制器读取并继承上次保存值。
// Replacement: updateOptions 仅更新当前草稿；任务检查点保存已创建任务参数
// Risk: Low；旧任务仍通过 selectTask 恢复自己的参数。
// Human Review: Required
// Original code:
//     runStorageEffect("planner-options", () => saveToLocalStorage(OPTIONS_KEY, toJS(this.options)));
  }

  updateSupplyPolicy(policy: BlueprintPlannerSupplyPolicy): void {
    if (!this.plan || this.viewTaskId !== null) return;
    this.plan = { ...this.plan, supplyPolicies: [...(this.plan.supplyPolicies ?? []).filter(entry => entry.itemId !== policy.itemId), policy] };
  }

  updateItemPolicy(policy: BlueprintPlannerItemPolicy): void {
    if (!this.plan || this.viewTaskId !== null) return;
    this.options = { ...this.options, itemPolicies: [...(this.options.itemPolicies ?? []).filter(entry => entry.itemId !== policy.itemId), policy] };
  }

  getRequest(): BlueprintPlannerRequest {
    if (this.plan === null) throw new Error("请先计算产线规划。");
    return { ...(this.blueprintRequest ?? {}), plan: structuredClone(this.plan), options: toJS(this.options) };
  }
}
