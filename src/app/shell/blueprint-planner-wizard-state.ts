import { makeAutoObservable } from "mobx";
import type { BlueprintPlannerOptions } from "@/domain/blueprint-planner";

export const PLANNER_STEPS = ["confirm", "name", "production", "layout", "manual", "boundary", "result"] as const;
export type PlannerStep = typeof PLANNER_STEPS[number];
export function visiblePlannerSteps(manualEnabled: boolean): readonly PlannerStep[] {
  return PLANNER_STEPS.filter(step => step !== "boundary" || manualEnabled);
}

export type PlannerDimensionMode = "straight" | "u-shaped" | "shortest";

/** UI 试做阶段的任务草稿；不进入规划请求、任务导出或搜索检查点。 */
// AI-CORRECTION 2026-11-13：导航仍为会话状态；尺寸和面积停止通过 Options 持久化并参与求解。
export class PlannerWizardDraft {
  step: PlannerStep = "confirm";
  furthestStep: PlannerStep = "confirm";
  completedSteps = new Set<PlannerStep>();
  reviewSteps = new Set<PlannerStep>();
  resetFields = new Set<string>();
  advancedOpen = false;
  dimensions: Record<PlannerDimensionMode, { edge: string; side: string }> = {
    straight: { edge: "", side: "" },
    "u-shaped": { edge: "", side: "" },
    shortest: { edge: "", side: "" },
  };
  stopOnArea = false;
  areaBelow = "";

  constructor(private readonly changed: (options: Partial<BlueprintPlannerOptions>) => void = () => {}) {
    makeAutoObservable(this, {}, { autoBind: true });
  }
  loadOptions(options: BlueprintPlannerOptions): void {
    const limits = options.dimensionLimits;
    this.dimensions = {
      straight: { edge: String(limits?.straight?.edge ?? ""), side: String(limits?.straight?.side ?? "") },
      "u-shaped": { edge: String(limits?.uShaped?.edge ?? ""), side: String(limits?.uShaped?.side ?? "") },
      shortest: { edge: String(limits?.shortest ?? ""), side: "" },
    };
    this.stopOnArea = options.stopAreaBelow !== undefined;
    this.areaBelow = String(options.stopAreaBelow ?? "");
  }
  private publishOptions(): void {
    const number = (value: string) => isPlannerLimit(value) ? Number(value) : undefined;
    this.changed({ dimensionLimits: {
      straight: { edge: number(this.dimensions.straight.edge), side: number(this.dimensions.straight.side) },
      uShaped: { edge: number(this.dimensions["u-shaped"].edge), side: number(this.dimensions["u-shaped"].side) },
      shortest: number(this.dimensions.shortest.edge),
    }, stopAreaBelow: this.stopOnArea ? number(this.areaBelow) : undefined });
  }
  setStep(step: PlannerStep): void {
    this.step = step;
    if (PLANNER_STEPS.indexOf(step) > PLANNER_STEPS.indexOf(this.furthestStep)) this.furthestStep = step;
  }
  canVisit(step: PlannerStep): boolean { return PLANNER_STEPS.indexOf(step) <= PLANNER_STEPS.indexOf(this.furthestStep); }
  confirmStep(step: PlannerStep): void { this.reviewSteps.delete(step); this.completedSteps.add(step); }
  invalidateFrom(step: PlannerStep): void {
    for (const id of PLANNER_STEPS.slice(PLANNER_STEPS.indexOf(step), PLANNER_STEPS.indexOf(this.furthestStep) + 1)) {
      this.reviewSteps.add(id); this.completedSteps.delete(id);
    }
  }
  noteReset(label: string): void { this.resetFields.add(label); }
  dismissResets(): void { this.resetFields.clear(); }
  setAdvancedOpen(open: boolean): void { this.advancedOpen = open; }
  setDimension(mode: PlannerDimensionMode, field: "edge" | "side", value: string): void {
    this.dimensions[mode][field] = value;
    this.publishOptions();
  }
  setStopOnArea(enabled: boolean): void { this.stopOnArea = enabled; this.publishOptions(); }
  setAreaBelow(value: string): void { this.areaBelow = value; this.publishOptions(); }
  isValid(mode: PlannerDimensionMode): boolean {
    return this.isDimensionsValid(mode) && (!this.stopOnArea || isPlannerLimit(this.areaBelow));
  }
  isDimensionsValid(mode: PlannerDimensionMode): boolean {
    const values = mode === "shortest" ? [this.dimensions[mode].edge]
      : [this.dimensions[mode].edge, this.dimensions[mode].side];
    return values.every(value => value === "" || isPlannerLimit(value));
  }
}

export function isPlannerLimit(value: string): boolean {
  return value.trim() !== "" && Number.isSafeInteger(Number(value)) && Number(value) > 0;
}

export function plannerDimensionMode(hasWarehouseSupply: boolean, shape: "straight" | "corner" | "u-shaped"): PlannerDimensionMode {
  return !hasWarehouseSupply || shape === "corner" ? "shortest" : shape;
}

/** 页面导航独立于运行中的任务，返回首页不会触发暂停或丢弃任务。 */
export class PlannerWizardState {
  home = true;
  draft: PlannerWizardDraft;
  private readonly drafts = new Map<string, PlannerWizardDraft>();

  constructor(private readonly changed: (options: Partial<BlueprintPlannerOptions>) => void = () => {}) {
    this.draft = new PlannerWizardDraft(changed);
    makeAutoObservable(this, {}, { autoBind: true });
  }
  showHome(): void { this.home = true; }
  createDraft(): void { this.draft = new PlannerWizardDraft(this.changed); this.home = false; }
  attachTask(taskId: string): void { this.drafts.set(taskId, this.draft); }
  selectTask(taskId: string | null, options?: BlueprintPlannerOptions): void {
    if (taskId === null) { this.showHome(); return; }
    const saved = this.drafts.get(taskId);
    this.draft = saved ?? new PlannerWizardDraft(this.changed);
    if (!saved && options) this.draft.loadOptions(options);
    this.drafts.set(taskId, this.draft);
    this.home = false;
  }
  forgetTask(taskId: string): void { this.drafts.delete(taskId); }
}
