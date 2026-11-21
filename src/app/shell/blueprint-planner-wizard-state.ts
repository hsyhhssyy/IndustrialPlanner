import { makeAutoObservable } from "mobx";
import type { BlueprintPlannerOptions } from "@/domain/blueprint-planner";

export const PLANNER_STEPS = ["confirm", "name", "production", "layout", "manual-options", "boundary", "manual", "result"] as const;
export type PlannerStep = typeof PLANNER_STEPS[number];
export function visiblePlannerSteps(manualEnabled: boolean): readonly PlannerStep[] {
  return PLANNER_STEPS.filter(step => (step !== "boundary" && step !== "manual") || manualEnabled);
}

export type PlannerDimensionAxis = "base" | "side";
export type PlannerAxisMode = "none" | "max" | "exact";

export type PlannerDimensionMode = "straight" | "u-shaped" | "shortest";

/** UI 试做阶段的任务草稿；不进入规划请求、任务导出或搜索检查点。 */
// AI-CORRECTION 2026-11-13：导航仍为会话状态；尺寸和面积停止通过 Options 持久化并参与求解。
export class PlannerWizardDraft {
  step: PlannerStep = "confirm";
  furthestStep: PlannerStep = "confirm";
  completedSteps = new Set<PlannerStep>();
  reviewSteps = new Set<PlannerStep>();
  resetFields = new Set<string>();
  // AI-REMOVED 2026-11-21: Reason: 尺寸始终展开，无折叠偏好消费者。Trigger: 本轮布局UI要求。
  // Evidence: BlueprintPlannerAdvanced已改直接fieldset。Replacement: None。Risk: Low。Human Review: Required
  // Original code: advancedOpen = false;
  dimensions: Record<PlannerDimensionMode, { edge: string; side: string }> = {
    straight: { edge: "", side: "" },
    "u-shaped": { edge: "", side: "" },
    shortest: { edge: "", side: "" },
  };
  stopOnArea = false;
  areaBelow = "";
  exactBaseLength = "";
  maxBaseLength = "";
  exactSideLength = "";
  maxSideLength = "";
  private blueprintDimensions = false;
  axisModes: Record<PlannerDimensionAxis, PlannerAxisMode> = { base: "none", side: "none" };

  constructor(private readonly changed: (options: Partial<BlueprintPlannerOptions>) => void = () => {}) {
    makeAutoObservable(this, {}, { autoBind: true });
  }
  loadOptions(options: BlueprintPlannerOptions, blueprint = false): void {
    this.blueprintDimensions = blueprint;
    const limits = options.dimensionLimits;
    const legacyLimits = blueprint ? limits : undefined;
    // AI-CORRECTION 2026-11-21：生产旧形态上限按未填写处理；仅原图入口加载这些字段。
    this.dimensions = {
      straight: { edge: String(legacyLimits?.straight?.edge ?? ""), side: String(legacyLimits?.straight?.side ?? "") },
      "u-shaped": { edge: String(legacyLimits?.uShaped?.edge ?? ""), side: String(legacyLimits?.uShaped?.side ?? "") },
      shortest: { edge: String(legacyLimits?.shortest ?? ""), side: "" },
    };
    this.exactBaseLength = String(limits?.exactBaseLength ?? "");
    this.maxBaseLength = String(limits?.maxBaseLength ?? "");
    this.exactSideLength = String(limits?.exactSideLength ?? "");
    this.maxSideLength = String(limits?.maxSideLength ?? "");
    this.axisModes = { base: limits?.exactBaseLength !== undefined ? "exact" : limits?.maxBaseLength !== undefined ? "max" : "none",
      side: limits?.exactSideLength !== undefined ? "exact" : limits?.maxSideLength !== undefined ? "max" : "none" };
    this.stopOnArea = options.stopAreaBelow !== undefined;
    this.areaBelow = String(options.stopAreaBelow ?? "");
  }
  private publishOptions(): void {
    const number = (value: string) => isPlannerLimit(value) ? Number(value) : undefined;
    // AI-REMOVED 2026-11-21: Reason: 新任务只写独立两轴，旧形态值仅有实际数据时显式保留。
    // Trigger: 两轴订正。Evidence: 直角不再新建最短边约束。Replacement: 下方四字段+legacy显式值。
    // Risk: 旧语义保留。Human Review: Required
    // Original code:
    // this.changed({ dimensionLimits: {
    // straight: { edge: number(this.dimensions.straight.edge), side: number(this.dimensions.straight.side) },
    // uShaped: { edge: number(this.dimensions["u-shaped"].edge), side: number(this.dimensions["u-shaped"].side) },
    // shortest: number(this.dimensions.shortest.edge),
    // exactBaseLength: number(this.exactBaseLength),
    // }, stopAreaBelow: this.stopOnArea ? number(this.areaBelow) : undefined });
    // }
    const legacy = {
      ...(this.dimensions.straight.edge || this.dimensions.straight.side ? { straight: {
        edge: number(this.dimensions.straight.edge), side: number(this.dimensions.straight.side) } } : {}),
      ...(this.dimensions["u-shaped"].edge || this.dimensions["u-shaped"].side ? { uShaped: {
        edge: number(this.dimensions["u-shaped"].edge), side: number(this.dimensions["u-shaped"].side) } } : {}),
      ...(this.dimensions.shortest.edge ? { shortest: number(this.dimensions.shortest.edge) } : {}),
    };
    this.changed({ dimensionLimits: { ...(this.blueprintDimensions ? legacy : {}), exactBaseLength: number(this.exactBaseLength), maxBaseLength: number(this.maxBaseLength),
      exactSideLength: number(this.exactSideLength), maxSideLength: number(this.maxSideLength) },
      stopAreaBelow: this.stopOnArea ? number(this.areaBelow) : undefined });
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
  // AI-REMOVED 2026-11-21: Reason: 高级折叠入口取消。Trigger: 尺寸直接显示。
  // Evidence: 无active消费者。Replacement: None。Risk: Low。Human Review: Required
  // Original code: setAdvancedOpen(open: boolean): void { this.advancedOpen = open; }
  setDimension(mode: PlannerDimensionMode, field: "edge" | "side", value: string): void {
    this.dimensions[mode][field] = value;
    this.publishOptions();
  }
  setExactBaseLength(value: string): void { this.axisModes.base = value === "" ? "none" : "exact"; this.maxBaseLength = ""; this.exactBaseLength = value; this.publishOptions(); }
  setAxisMode(axis: PlannerDimensionAxis, mode: PlannerAxisMode): void {
    const value = this.axisValue(axis);
    this.axisModes[axis] = mode;
    if (axis === "base") { this.maxBaseLength = mode === "max" ? value : ""; this.exactBaseLength = mode === "exact" ? value : ""; }
    else { this.maxSideLength = mode === "max" ? value : ""; this.exactSideLength = mode === "exact" ? value : ""; }
    this.publishOptions();
  }
  axisValue(axis: PlannerDimensionAxis): string {
    return axis === "base" ? this.axisModes.base === "exact" ? this.exactBaseLength : this.maxBaseLength
      : this.axisModes.side === "exact" ? this.exactSideLength : this.maxSideLength;
  }
  setAxisValue(axis: PlannerDimensionAxis, value: string): void {
    if (axis === "base") { if (this.axisModes.base === "exact") this.exactBaseLength = value; else this.maxBaseLength = value; }
    else if (this.axisModes.side === "exact") this.exactSideLength = value; else this.maxSideLength = value;
    this.publishOptions();
  }
  axisValid(axis: PlannerDimensionAxis): boolean {
    const value = this.axisValue(axis);
    return this.axisModes[axis] === "none" || isPlannerLimit(value) && (this.axisModes[axis] !== "exact" || Number(value) <= 70);
  }
  // AI-REMOVED 2026-11-21: Reason: 生产旧限制面板取消，无active消费者。Trigger: 用户订正。
  // Evidence: Advanced/summary已仅显示两轴。Replacement: None。Risk: Low。Human Review: Required
  // Original code:
  // get hasLegacyDimensions(): boolean { return Object.values(this.dimensions).some(pair => pair.edge !== "" || pair.side !== ""); }
  // clearLegacyDimensions(): void {
  // this.dimensions = { straight: { edge: "", side: "" }, "u-shaped": { edge: "", side: "" }, shortest: { edge: "", side: "" } };
  // this.publishOptions();
  // }
  setStopOnArea(enabled: boolean): void { this.stopOnArea = enabled; this.publishOptions(); }
  setAreaBelow(value: string): void { this.areaBelow = value; this.publishOptions(); }
  isValid(mode: PlannerDimensionMode): boolean {
    return this.isDimensionsValid(mode) && (!this.stopOnArea || isPlannerLimit(this.areaBelow));
  }
  get exactBaseLengthValid(): boolean {
    return this.exactBaseLength === "" || isPlannerLimit(this.exactBaseLength) && Number(this.exactBaseLength) <= 70;
  }
  isDimensionsValid(mode: PlannerDimensionMode): boolean {
    const values = mode === "shortest" ? [this.dimensions[mode].edge]
      : [this.dimensions[mode].edge, this.dimensions[mode].side];
    return values.every(value => value === "" || isPlannerLimit(value)) && this.axisValid("base") && this.axisValid("side")
      && !(this.axisModes.base === "exact" && this.axisModes.side === "exact");
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
  selectTask(taskId: string | null, options?: BlueprintPlannerOptions, blueprint = false): void {
    if (taskId === null) { this.showHome(); return; }
    const saved = this.drafts.get(taskId);
    this.draft = saved ?? new PlannerWizardDraft(this.changed);
    if (!saved && options) this.draft.loadOptions(options, blueprint);
    this.drafts.set(taskId, this.draft);
    this.home = false;
  }
  forgetTask(taskId: string): void { this.drafts.delete(taskId); }
}
