import { readPlannerTaskFile } from "./planner-task-file";
import { DEFAULT_BLUEPRINT_OPTIMIZATIONS, hasPlannerStarted, isBlueprintRecognitionRequest } from "@/shared/planner-task";
// AI-REMOVED 2026-10-03: Reason: 全局选项字段收敛后无须 BlueprintPlannerOptions。Trigger: 逐物品配置。
// Evidence: OPTION_FIELDS 仅保留两项。Replacement: 字段字面量。Risk: Low。Human Review: Required
// Original code: import type { BlueprintPlannerOptions } from "@/domain/blueprint-planner";
import { collectPlannerItemBoundaries, PlannerItemRules, invalidBlueprintWarehouseSupplies } from "@/shared/planner-item-policy";
import { BlueprintPlannerItemPolicies } from "./blueprint-planner-item-policies";
import { useEffect, useMemo, useRef, useState } from "react";
import { reaction, toJS } from "mobx";
import { observer } from "mobx-react-lite";
// AI-REMOVED 2026-10-13: 文件类型移入 readPlannerTaskFile，主界面不再解析。
// Trigger: 一次性 Worker 导入；Replacement: planner-task-file.ts；Risk: Low；Human Review: Required
// Original code: import type { BlueprintPlannerAreaPoint, BlueprintPlannerTaskFile } from "@/domain/blueprint-planner";
import type { BlueprintPlannerAreaPoint } from "@/domain/blueprint-planner";
import type { UiKey } from "@/shared/i18n";
import type { AppHost } from "../host";
import { enterBlueprintPlacement } from "../input";
import { createDefaultDialogStateForKey } from "../state";
import { DialogShell } from "./shared/dialog-shell";
import { PlannerTaskFlow } from "./production-planning";
import { formatPlannerElapsed, plannerAreaCoordinate, plannerAreaCurvePoints, plannerAreaTicks, plannerLogCoordinate, plannerProposalRate, samplePlannerProposalRate } from "./blueprint-planner-statistics";
import styles from "./blueprint-planner-dialog.module.scss";
import { BlueprintPlannerEnvironment } from "./blueprint-planner-environment";
import { PlannerSupplyRules } from "@/shared/planner-supply";
import { BlueprintIdentification } from "./blueprint-identification";
import { describePlannerHistoryTask } from "./blueprint-planner-history";
import { EdaRegressionController, EdaRegressionPanel } from "./eda-regression";

const OPTION_FIELDS: readonly { key: "warehouseBus" | "plantStartup" | "warehousePortPlacement"; label: UiKey; choices: readonly [string, UiKey][] }[] = [
  // AI-REMOVED 2026-10-03:
  // Reason: 四类意图改为逐物品编辑。Trigger: 用户要求精确选择。
  // Evidence: BlueprintPlannerItemPolicies 展示任务边界。Replacement: BlueprintPlannerItemPolicies。
  // Risk: Low；旧字段保留任务缺省值。Human Review: Required
  // Original code:
  //   { key: "solidSupply", label: "eda.solidSupply", choices: [["external", "eda.externalBelt"], ["warehouse", "eda.warehouseSupply"]] },
  // AI-REMOVED 2026-10-03:
  // Reason: 四类意图改为逐物品编辑。Trigger: 用户要求精确选择。
  // Evidence: BlueprintPlannerItemPolicies 展示任务边界。Replacement: BlueprintPlannerItemPolicies。
  // Risk: Low；旧字段保留任务缺省值。Human Review: Required
  // Original code:
  //   { key: "fluidSupply", label: "eda.fluidSupply", choices: [["external", "eda.externalPipe"], ["conduit", "eda.conduitSupply"]] },
  { key: "warehousePortPlacement", label: "eda.warehousePortPlacement", choices: [["any", "eda.portsAny"], ["continuous", "eda.portsContinuous"], ["full-side", "eda.portsFullSide"]] },
  { key: "warehouseBus", label: "eda.warehouseBus", choices: [["straight", "eda.straight"], ["corner", "eda.corner"], ["u-shaped", "eda.uShaped"]] },
  // AI-REMOVED 2026-10-03:
  // Reason: 四类意图改为逐物品编辑。Trigger: 用户要求精确选择。
  // Evidence: BlueprintPlannerItemPolicies 展示任务边界。Replacement: BlueprintPlannerItemPolicies。
  // Risk: Low；旧字段保留任务缺省值。Human Review: Required
  // Original code:
  //   { key: "solidOutput", label: "eda.solidOutput", choices: [["auto", "eda.autoOutput"], ["warehouse", "eda.warehouseOutput"], ["stash", "eda.stashOutput"]] },
  // AI-REMOVED 2026-10-03:
  // Reason: 四类意图改为逐物品编辑。Trigger: 用户要求精确选择。
  // Evidence: BlueprintPlannerItemPolicies 展示任务边界。Replacement: BlueprintPlannerItemPolicies。
  // Risk: Low；旧字段保留任务缺省值。Human Review: Required
  // Original code:
  //   { key: "byproducts", label: "eda.byproducts", choices: [["output", "eda.output"], ["destroy", "eda.destroy"]] },
  { key: "plantStartup", label: "eda.plantStartup", choices: [["preload", "eda.preload"], ["warehouse", "eda.warehouseStartup"]] },
];

function AreaCurve({ points, initialArea, proposals, label, xLabel, yLabel, initialLabel, verifiedLabel }: {
  points: readonly BlueprintPlannerAreaPoint[]; initialArea?: number; proposals: number; label: string; xLabel: string; yLabel: string;
  initialLabel: string; verifiedLabel: string;
}) {
  const curve = plannerAreaCurvePoints(points, initialArea);
  const reference = curve.find(point => !point.verified);
  const last = curve.at(-1)!;
  const width = 600, left = 58, right = 588, top = 34, bottom = 160;
  const ticks = plannerAreaTicks(curve.map(point => ({ evaluatedProposals: point.evaluatedProposals, bestArea: point.area })), proposals, left, right);
  const height = bottom + 46;
  const minX = curve[0]!.evaluatedProposals;
  const maxX = Math.max(minX, proposals);
  // AI-REMOVED 2026-10-03:
  // Reason: Y 轴改为从零开始的 log(1+x)，不再用极值差拉伸。
  // Trigger: 用户要求面积图两轴从零开始的对数坐标。
  // Evidence: 旧 span 与 minArea 将最小面积映射到轴底部附近。
  // Replacement: plannerLogCoordinate 与下方 areaTicks。
  // Risk: 接近的面积值视觉差异缩小；圆点保留精确数值。Human Review: Required
  // Original code:
  // const minArea = Math.min(...points.map(point => point.bestArea));
  // const span = Math.max(1, maxArea - minArea);
  // AI-CORRECTION 2026-10-03: 用户取消 Y 轴对数与零起点，恢复实际极值范围；单点与留白统一由 plannerAreaCoordinate 处理。
  const minArea = Math.min(...curve.map(point => point.area));
  const maxArea = Math.max(...curve.map(point => point.area));
  const x = (value: number) => plannerLogCoordinate(value, minX, maxX, left, right);
  const y = (value: number) => plannerAreaCoordinate(value, minArea, maxArea, top, bottom);
  // AI-REMOVED 2026-10-03:
  // Reason: Y 轴改为实际面积范围内的线性刻度。
  // Trigger: 用户要求 X 对数、Y 线性，使等量面积下降与翻倍搜索量形成近似斜线。
  // Evidence: 对数 Y 轴压缩高位面积差，零起点掩盖小幅改善。
  // Replacement: 下方实际极值之间的等距面积刻度。
  // Risk: Low；不改变原始面积与下降点。Human Review: Required
  // Original code:
  // const areaTicks = [0];
  // for (let value = 1; value < maxArea; value *= 10) {
  //   if (y(value) - y(maxArea) >= 14 && y(areaTicks.at(-1)!) - y(value) >= 14) areaTicks.push(value);
  // }
  // if (maxArea > 0) areaTicks.push(maxArea);
  const areaTicks = [...new Set(Array.from({ length: 5 }, (_, index) => Math.round(minArea + (maxArea - minArea) * index / 4)))];
  const first = points[0];
  const path = first ? [`M ${x(first.evaluatedProposals)} ${y(first.bestArea)}`] : [];
  for (let index = 1; index < points.length; index++) {
    const point = points[index]!;
    path.push(`H ${x(point.evaluatedProposals)} V ${y(point.bestArea)}`);
  }
  if (first) path.push(`H ${x(maxX)}`);
  const referencePath = reference ? [`M ${x(reference.evaluatedProposals)} ${y(reference.area)} H ${x(first?.evaluatedProposals ?? maxX)}`] : [];
  if (reference && first) referencePath.push(`V ${y(first.bestArea)}`);
  return <figure className={styles.areaCurve}>
    <figcaption>{label}{reference ? <span className={styles.areaLegend}>○ {initialLabel}{first ? ` · ● ${verifiedLabel}` : ""}</span> : null}</figcaption>
    <div className={styles.areaPlot}><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label}: ${maxX.toLocaleString()}, ${last.area} · ${last.verified ? verifiedLabel : initialLabel}`}>
      <path className={styles.areaAxis} d={`M ${left} ${top} V ${bottom} H ${right}`} />
      {reference ? <path className={styles.areaReferenceLine} d={referencePath.join(" ")} /> : null}
      {first ? <path className={styles.areaLine} d={path.join(" ")} /> : null}
      {reference ? <circle className={styles.areaReferencePoint} cx={x(reference.evaluatedProposals)} cy={y(reference.area)} r="3.5">
        <title>{`0 · ${reference.area} · ${initialLabel}`}</title>
      </circle> : null}
      {points.map(point => <circle key={`${point.evaluatedProposals}-${point.bestArea}`}
        className={styles.areaPoint} cx={x(point.evaluatedProposals)} cy={y(point.bestArea)} r="3.5">
        <title>{`${point.evaluatedProposals.toLocaleString()} · ${point.bestArea} · ${verifiedLabel}`}</title>
      </circle>)}
      {/* AI-REMOVED 2026-10-03:
        Reason: 仅首尾刻度不能标注每次面积下降。Trigger: 用户要求 X 轴记录下降时的提案次数。
        Evidence: 原图仅绘制 0 与累计总数。Replacement: 下方 ticks，密集标签错行。
        Risk: 下降点密集时图表增高。Human Review: Required
        Original code:
        <text x={left} y={height - 4} textAnchor="start">0</text>
        <text x={right} y={height - 4} textAnchor="end">{maxX.toLocaleString()}</text>
      */}
      {ticks.map(tick => <g key={tick.value}>
        <path className={styles.areaTick} d={`M ${tick.x} ${bottom} V ${bottom + 5}`} />
        <text x={tick.labelX} y={bottom + 18} textAnchor="start">{tick.label}</text>
      </g>)}
      {/* AI-REMOVED 2026-10-03:
        Reason: 极值标签由零点和对数刻度替代。Trigger: 用户要求从零开始的对数轴。
        Evidence: 原 Y 轴仅显示最小/最大面积。Replacement: 下方 areaTicks 和两轴末端标签。
        Risk: Low。Human Review: Required
        Original code:
        <text x={left - 5} y={y(maxArea) + 4} textAnchor="end">{maxArea}</text>
        {minArea !== maxArea ? <text x={left - 5} y={y(minArea) + 4} textAnchor="end">{minArea}</text> : null}
      */}
      {areaTicks.map(value => <g key={value}>
        <path className={styles.areaTick} d={`M ${left - 4} ${y(value)} H ${left}`} />
        <text x={left - 7} y={y(value) + 4} textAnchor="end">{value.toLocaleString()}</text>
      </g>)}
      <text x={left} y={16}>{yLabel}</text>
      <text x={right} y={height - 6} textAnchor="end">{xLabel}</text>
    </svg></div>
  </figure>;
}

function PlannerTaskDeleteButton({ disabled, onConfirm, t }: {
  disabled: boolean; onConfirm: () => void; t: AppHost["actions"]["translate"];
}) {
  const [visible, setVisible] = useState(false);
  const dialogState = useMemo(() => createDefaultDialogStateForKey("eda-delete-task"), []);
  const close = () => setVisible(false);
  return <>
    <button type="button" disabled={disabled} onClick={() => setVisible(true)}>{t("eda.deleteTask")}</button>
    <DialogShell dialogKey="eda-delete-task" dialogState={{ ...dialogState, visible }}
      title={t("eda.deleteTask")} titleId="eda-delete-task-title" closeTitle={t("action.close")}
      maximizeTitle="" restoreTitle="" showMaximizeButton={false}
      shellStyle={{ width: "min(420px, 100%)", height: "auto", minHeight: 0 }}
      onClose={close} onToggleMaximized={() => {}}>
      <div className={styles.deleteConfirmation}>
        <p>{t("eda.confirmDelete")}</p>
        <div className={styles.deleteConfirmationActions}>
          <button type="button" onClick={close}>{t("action.cancel")}</button>
          <button type="button" disabled={disabled} onClick={() => {
            if (disabled) return;
            close(); onConfirm();
          }}>{t("eda.deleteTask")}</button>
        </div>
      </div>
    </DialogShell>
  </>;
}

export const BlueprintPlannerDialog = observer(function BlueprintPlannerDialog({ appHost }: { appHost: AppHost }) {
  const controller = appHost.blueprintPlannerDialog;
  const blueprintPlanningEnabled = controller.blueprintPlanningEnabled;
  const planner = appHost.workspace.blueprintPlanner;
  const t = appHost.actions.translate;
  const regression = useMemo(() => new EdaRegressionController(() => appHost.workspace.blueprintPlanner), [appHost]);
  const regressionDialog = useMemo(() => createDefaultDialogStateForKey("eda-regression"), []);
  useEffect(() => { regression.activate(); return () => regression.dispose(); }, [regression]);
  const [, refresh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const [pausingTaskId, setPausingTaskId] = useState<string | null>(null);
  // 暂停要等 Worker 结算及检查点保存完成；窗口隐藏期间也跟随任务解锁清除提示。
  useEffect(() => reaction(() => planner?.state.activeTaskId, () => setPausingTaskId(null)), [planner]);
  // AI-REMOVED 2026-10-13:
  // Reason: 四项优化作为页面内配置，取消首次开始时的额外弹窗状态。
  // Trigger: 用户确认 A 方案，要求与摆放规则组成一体。
  // Evidence: 这两个状态只用于 eda-blueprint-optimizations 弹窗。
  // Replacement: 下方 blueprintPlacementOptions 与底部直接开始规划入口。
  // Risk: Low；权限仍逐任务持久化并在首次规划后锁定。
  // Human Review: Required
  // Original code:
  // const [optimizationTaskId, setOptimizationTaskId] = useState<string | null>(null);
  // const optimizationDialogState = useMemo(() => createDefaultDialogStateForKey("eda-blueprint-optimizations"), []);
  const [recentRate, setRecentRate] = useState<ReturnType<typeof samplePlannerProposalRate>>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedId = controller.viewTaskId;
  useEffect(() => {
    if (!controller.dialogState.visible) return;
    const interval = setInterval(() => {
      const current = selectedId === null ? null : planner?.queries.getTask(selectedId) ?? null;
      setRecentRate(previous => samplePlannerProposalRate(previous, current));
      refresh(value => value + 1);
    }, 500);
    return () => clearInterval(interval);
  }, [controller.dialogState.visible, planner, selectedId]);
  const revision = planner?.state.revision ?? 0;
  // AI-REMOVED 2026-10-03:
  // Reason: 采样定时器必须跟随选中任务重建。Trigger: 新增提案速度。
  // Evidence: effect 需要 selectedId 作为依赖。Replacement: 上方 effect 前的同名声明。
  // Risk: Low。Human Review: Required
  // Original code:
  // const selectedId = controller.viewTaskId;
  const progress = selectedId === null ? null : planner?.queries.getTask(selectedId) ?? null;
  const pausing = pausingTaskId !== null && pausingTaskId === selectedId && pausingTaskId === controller.activeTaskId;
  const randomSeed = selectedId === null ? null : planner?.queries.getRandomSeed(selectedId) ?? null;
  const result = useMemo(() => {
    void revision;
    return selectedId === null ? null : planner?.queries.getResult(selectedId) ?? null;
  }, [planner, revision, selectedId]);
  const recognition = useMemo(() => {
    void revision;
    const request = selectedId === null ? null : planner?.queries.getLastRequest(selectedId);
    return request && isBlueprintRecognitionRequest(request) ? request : null;
  }, [planner, revision, selectedId]);
  const timeFormatter = useMemo(() => new Intl.DateTimeFormat(appHost.state.settings.locale, {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }), [appHost.state.settings.locale]);
  const history = useMemo(() => {
    void revision;
    return planner?.queries.listTasks().flatMap(task => {
      const request = planner.queries.getLastRequest(task.taskId);
      if (!blueprintPlanningEnabled && !controller.isTaskVisible(request)) return [];
      // AI-REMOVED 2026-10-09:
      // Reason: 空名称缺少兜底，蓝图优化被识别阶段二分法误标为产线计算。
      // Trigger: 用户要求统一左侧任务标题、类别和布局。
      // Evidence: 新建产线入口传入空名称；优化请求保留 blueprintSource。
      // Replacement: describePlannerHistoryTask。
      // Risk: Low；仅修改展示，不改写任务数据。Human Review: Required
      // Original code:
      // return { ...task, recognizing: !!request && isBlueprintRecognitionRequest(request),
      //   name: request ? isBlueprintRecognitionRequest(request) ? request.input.blueprint.name : request.plan.name : task.taskId };
      return [{ ...task, ...describePlannerHistoryTask(request, appHost.workspace.registry, t),
        timeLabel: timeFormatter.format(task.startedAt) }];
    }) ?? [];
  }, [planner, revision, timeFormatter, appHost.workspace.registry, t, controller, blueprintPlanningEnabled]);
  const supply = useMemo(() => {
    if (!controller.plan) return { view: null, error: null };
    try { return { view: new PlannerSupplyRules(appHost.workspace.registry, controller.plan, controller.options.converterStartup).view(), error: null }; }
    catch (failure) { return { view: null, error: failure instanceof Error ? failure.message : String(failure) }; }
  }, [appHost.workspace.registry, controller.plan, controller.options.converterStartup]);
  if (!controller.dialogState.visible) return null;
  const busy = controller.taskLocked || fileBusy;
  const planningStarted = progress !== null && hasPlannerStarted(progress);
  const placementLocked = progress !== null && !recognition && (!controller.blueprintRequest || planningStarted);
  const anyBusy = controller.taskLocked;
  const compact = appHost.state.screenProfile.deviceClass === "mobile";
  const plan = controller.plan;
  const itemRules = new PlannerItemRules(appHost.workspace.registry, controller.options);
  const blueprintInput = recognition?.input ?? controller.blueprintRequest?.blueprintSource;
  const invalidBlueprintSupply = !!blueprintInput && invalidBlueprintWarehouseSupplies(appHost.workspace.registry, blueprintInput, controller.options).length > 0;
  const invalidWarehouseSupply = invalidBlueprintSupply || !!(plan && supply.view && !controller.blueprintRequest
    && collectPlannerItemBoundaries(appHost.workspace.registry, plan, supply.view).some(row => row.supply && itemRules.requiresWarehouseSupply(row.itemId)));
  const validRoundSettings = Number.isSafeInteger(controller.options.evaluationsPerRound) && controller.options.evaluationsPerRound >= 10_000
    && controller.options.evaluationsPerRound % 10_000 === 0;
  // AI-REMOVED 2026-10-03:
  // Reason: 界面不再输入数字，校验与核心数告警由自动调度替代。
  // Trigger: 用户授权自动 CPU 并发。Evidence: Host 按吞吐和响应调节。
  // Replacement: 下方只读自动状态。Risk: Low。Human Review: Required
  // Original code:
  //   const validConcurrency = Number.isSafeInteger(controller.options.concurrency) && controller.options.concurrency! >= 1
  //     && controller.options.concurrency! <= 32;
  //   const hardwareConcurrency = typeof navigator === "undefined" ? undefined : navigator.hardwareConcurrency;
  //   const warnConcurrency = shouldWarnPlannerConcurrency(controller.options.concurrency ?? 1, hardwareConcurrency);
  const act = (action: () => void | Promise<void>) => {
    setError(null);
    try { void Promise.resolve(action()).catch(failure => setError(failure instanceof Error ? failure.message : String(failure))); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
  };
  const updatePlacementOption = (key: "warehouseBus" | "plantStartup" | "warehousePortPlacement", value: string) => act(async () => {
    if (busy || placementLocked) return;
    if (selectedId === null) { controller.updateOptions({ [key]: value }); return; }
    if (!planner) return;
    setFileBusy(true);
    try {
      const options = { ...toJS(controller.options), [key]: value };
      if (options.warehousePortPlacement === "full-side") options.warehouseBus = "straight";
      await planner.actions.updateBlueprintOptions(selectedId, options);
      if (controller.viewTaskId === selectedId) controller.updateOptions(options);
    } finally { setFileBusy(false); }
  });
  // AI-REMOVED 2026-10-13:
  // Reason: 布局字段重复渲染；抽出两种任务共用的布局分组。
  // Trigger: 用户批准 EDA 选项分组与 CPU/GPU switch，并要求平板视觉验证。
  // Evidence: 原蓝图分组与下方通用网格分别渲染 OPTION_FIELDS。
  // Replacement: 本文件 layoutOptions / blueprintPlacementOptions。
  // Risk: Low；保持原有参数、任务锁定和下一轮执行语义。
  // Human Review: Required
  // Original code:
  //   const blueprintPlacementOptions = blueprintInput ? <div className={styles.blueprintPlacement}>
  //     <fieldset className={`${styles.options} ${styles.placementRules}`} disabled={busy}>
  //       {OPTION_FIELDS.filter(field => field.key !== "plantStartup").map(field => <label key={field.key}><span>{t(field.label)}</span>
  //         <select disabled={placementLocked || field.key === "warehouseBus" && controller.options.warehousePortPlacement === "full-side"}
  //           value={controller.options[field.key]} onChange={event => updatePlacementOption(field.key, event.target.value)}>
  //           {field.choices.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
  //         </select></label>)}
  //     </fieldset>
  //     <section aria-labelledby="eda-optimization-options-title">
  //       <div className={styles.optimizationHeading}><strong id="eda-optimization-options-title">{t("eda.optimizationOptions")}</strong></div>
  //       <div className={styles.optimizationChoices}>
  //         {(["reassignPorts", "reassignConnections", "rebuildLogistics", "mergeBoundaryFacilities"] as const).map(key => <label key={key} className={styles.optimizationChoice}>
  //           <span><strong>{t(`eda.optimization.${key}`)}</strong><small id={`eda-${key}-description`}>{t(`eda.optimization.${key}.description`)}</small></span>
  //           <input type="checkbox" role="switch" aria-label={t(`eda.optimization.${key}`)} aria-describedby={`eda-${key}-description`}
  //             checked={(controller.options.blueprintOptimizations ?? DEFAULT_BLUEPRINT_OPTIMIZATIONS)[key]} disabled={busy || placementLocked}
  //             onChange={event => {
  //               const checked = event.currentTarget.checked;
  //               act(async () => {
  //                 if (!planner || !selectedId || planningStarted || busy) return;
  //                 setFileBusy(true);
  //                 const previous = toJS(controller.options);
  //                 try {
  //                   const options = { ...previous, blueprintOptimizations: {
  //                     ...(previous.blueprintOptimizations ?? DEFAULT_BLUEPRINT_OPTIMIZATIONS), [key]: checked,
  //                   } };
  //                   controller.updateOptions(options);
  //                   await planner.actions.updateBlueprintOptions(selectedId, options);
  //                   if (controller.viewTaskId === selectedId) controller.updateOptions(options);
  //                 } catch (failure) {
  //                   if (controller.viewTaskId === selectedId) controller.updateOptions(previous);
  //                   throw failure;
  //                 } finally { setFileBusy(false); }
  //               });
  //             }} />
  //         </label>)}
  //       </div>
  //     </section>
  //   </div> : null;
  // AI-REMOVED 2026-10-13:
  // Reason: 混合网格按用途拆分，CPU/GPU 复选框改为现有 switch 视觉。
  // Trigger: 用户批准 EDA 选项分组与 CPU/GPU switch，并要求平板视觉验证。
  // Evidence: 布局、启动、预算、计算资源同处一个 fieldset。
  // Replacement: 本文件布局规则、启动方式、计算设置 fieldset。
  // Risk: Low；保持原有参数、任务锁定和下一轮执行语义。
  // Human Review: Required
  // Original code:
  //             <fieldset className={styles.options} disabled={busy}>
  //               {OPTION_FIELDS.filter(() => !controller.blueprintRequest).map(field => <label key={field.key}><span>{t(field.label)}</span>
  //                 <select disabled={placementLocked || field.key === "warehouseBus" && controller.options.warehousePortPlacement === "full-side"} value={controller.options[field.key]}
  //                   onChange={event => updatePlacementOption(field.key, event.target.value)}>
  //                   {field.choices.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
  //                 </select></label>)}
  //               {/* AI-REMOVED 2026-09-30: 用户批准删除时间预算；替代：下方提案预算。Risk: Low。Human Review: Required
  //               <label><span>{t("eda.budget")}</span><input type="number" min="10" step="10" value={controller.options.budgetMs / 1000}
  //                 onChange={event => controller.updateOptions({ budgetMs: Number(event.target.value) * 1000 })} /></label>
  //               */}
  //               <label><span>{t("eda.evaluationsPerRound")}</span><input type="number" min="1" step="1"
  //                 value={controller.options.evaluationsPerRound === 0 ? "" : controller.options.evaluationsPerRound / 10_000}
  //                 onChange={event => controller.updateOptions({ evaluationsPerRound: Number(event.target.value) * 10_000 })} /></label>
  //               {/* AI-REMOVED 2026-10-03:
  //                 Reason: 并发数不再由用户手填。Trigger: 用户确认自动并发。
  //                 Evidence: Planner 自动调度与 activeWorkerCount 契约。
  //                 Replacement: 下方自动状态输出。Risk: Low。Human Review: Required
  //                 Original code:
  //               <label><span>{t("eda.concurrency")}</span><input type="number" min="1" max="32" step="1"
  //                 value={controller.options.concurrency ?? 1}
  //                 aria-describedby={warnConcurrency ? "eda-concurrency-warning" : undefined}
  //                 onChange={event => controller.updateOptions({ concurrency: Number(event.target.value) })} />
  //                 {warnConcurrency ? <span id="eda-concurrency-warning" role="status" className={styles.error}>
  //                   {t("eda.concurrencyWarning").replace("{cores}", String(hardwareConcurrency))}
  //                 </span> : null}</label>
  //               */}
  //               {/* AI-REMOVED 2026-10-03:
  //                 Reason: 只读并发数不能切换单 Worker，而且搜索与验证交替会显示 0/1。
  //                 Trigger: 用户要求 CPU+GPU 复选框。Evidence: Windows 真机决策记录。
  //                 Replacement: 下方复选框。Risk: Low。Human Review: Required
  //                 Original code:
  //               <label><span>{t("eda.concurrency")}</span><output>
  //                 {progress?.status === "running" ? t("eda.activeConcurrency").replace("{count}", String(progress.activeWorkerCount ?? 0))
  //                   : t("eda.autoConcurrency")}
  //               </output></label>
  //               */}
  //               <div className={styles.acceleration}>
  //                 <label className={styles.parallel}><input type="checkbox" checked={controller.options.concurrency === "auto"}
  //                   onChange={event => controller.updateOptions({ concurrency: event.target.checked ? "auto" : 1 })} />
  //                   <span>{t("eda.concurrency")}</span></label>
  //                 <label className={styles.parallel}><input type="checkbox" checked={controller.options.gpu === true}
  //                   onChange={event => controller.updateOptions({ gpu: event.target.checked })} />
  //                   <span>{t("eda.gpu")}</span></label>
  //               </div>
  //               {!controller.blueprintRequest ? <label><span>{t("eda.converterStartup")}</span>
  //                 <select disabled={progress !== null} value={controller.options.converterStartup ?? "reject"}
  //                   onChange={event => controller.updateOptions({ converterStartup: event.target.value as "manual" | "tank" | "reject" })}>
  //                   <option value="manual">{t("eda.converterStartupManual")}</option>
  //                   <option value="tank">{t("eda.converterStartupTank")}</option>
  //                   <option value="reject">{t("eda.converterStartupReject")}</option>
  //                 </select></label> : null}
  //             </fieldset>
  const layoutOptions = <fieldset className={styles.optionGroup} disabled={busy}>
    <legend>{t("eda.layoutRules")}</legend>
    <div className={`${styles.options} ${styles.placementRules}`}>
      {OPTION_FIELDS.filter(field => field.key !== "plantStartup").map(field => <label key={field.key}><span>{t(field.label)}</span>
        <select disabled={placementLocked || field.key === "warehouseBus" && controller.options.warehousePortPlacement === "full-side"}
          value={controller.options[field.key]} onChange={event => updatePlacementOption(field.key, event.target.value)}>
          {field.choices.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
        </select></label>)}
    </div>
  </fieldset>;
  const blueprintPlacementOptions = blueprintInput ? <div className={styles.blueprintPlacement}>
    {layoutOptions}
    <section className={styles.optionGroup} aria-labelledby="eda-optimization-options-title">
      <div className={styles.optimizationHeading}><strong id="eda-optimization-options-title">{t("eda.optimizationOptions")}</strong></div>
      <div className={styles.optimizationChoices}>
        {(["reassignPorts", "reassignConnections", "rebuildLogistics", "mergeBoundaryFacilities"] as const).map(key => <label key={key} className={styles.optimizationChoice}>
          <span><strong>{t(`eda.optimization.${key}`)}</strong><small id={`eda-${key}-description`}>{t(`eda.optimization.${key}.description`)}</small></span>
          <input type="checkbox" role="switch" aria-label={t(`eda.optimization.${key}`)} aria-describedby={`eda-${key}-description`}
            checked={(controller.options.blueprintOptimizations ?? DEFAULT_BLUEPRINT_OPTIMIZATIONS)[key]} disabled={busy || placementLocked}
            onChange={event => {
              const checked = event.currentTarget.checked;
              act(async () => {
                if (!planner || !selectedId || planningStarted || busy) return;
                setFileBusy(true);
                const previous = toJS(controller.options);
                try {
                  const options = { ...previous, blueprintOptimizations: {
                    ...(previous.blueprintOptimizations ?? DEFAULT_BLUEPRINT_OPTIMIZATIONS), [key]: checked,
                  } };
                  controller.updateOptions(options);
                  await planner.actions.updateBlueprintOptions(selectedId, options);
                  if (controller.viewTaskId === selectedId) controller.updateOptions(options);
                } catch (failure) {
                  if (controller.viewTaskId === selectedId) controller.updateOptions(previous);
                  throw failure;
                } finally { setFileBusy(false); }
              });
            }} />
        </label>)}
      </div>
    </section>
  </div> : null;
  const select = (id: string) => {
    if (controller.taskLocked && id !== controller.activeTaskId) return;
    const request = planner?.queries.getLastRequest(id);
    controller.selectTask(id, request ?? undefined);
    setError(null);
  };
  const openProductionPlanning = () => {
    if (controller.taskLocked || fileBusy) return;
    controller.close();
    appHost.internalActions.setDialogTab("toolbox", "production-planning");
    appHost.internalActions.openDialog("toolbox");
  };
  const place = (source: "mouse" | "touch") => act(() => {
    const editor = appHost.workspace.editor;
    if (result === null || editor === null) return;
    const entered = enterBlueprintPlacement({ appHost, editor,
      record: { ...result.blueprint, parentFolderId: result.folderId }, source, initialMousePosition: null });
    if (entered.status === "handled") controller.close(); else setError(t("eda.placeFailed"));
  });
  const getConfiguredRequest = () => {
    const request = controller.getRequest();
    if (request.blueprintSource) return request;
    // 保存当前可见路线的确定选择，隐藏上游不成为额外的供给授权。
    const supplyPolicies = supply.view?.rows.flatMap(row => !row.inherited && row.policy ? [row.policy] : []) ?? request.plan.supplyPolicies;
    const rules = new PlannerItemRules(appHost.workspace.registry, request.options);
    const itemPolicies = supply.view ? collectPlannerItemBoundaries(appHost.workspace.registry, request.plan, supply.view).map(row => ({
      itemId: row.itemId, ...(row.supply ? { supply: rules.supply(row.itemId) } : {}),
      ...(row.output && rules.isSolid(row.itemId) ? { output: rules.output(row.itemId) } : {}),
      ...(row.byproducts ? { byproducts: rules.byproducts(row.itemId) } : {}),
    })) : request.options.itemPolicies;
    return { ...request, plan: { ...request.plan, supplyPolicies }, options: { ...request.options, itemPolicies } };
  };
  const download = () => act(() => {
    // AI-REMOVED 2026-10-04:
    // Reason: 下载入口需要支持尚未启动的配置草稿。
    // Trigger: 用户要求创建任务即可下载。
    // Evidence: 草稿有 plan，但 viewTaskId 为 null；原分支直接返回。
    // Replacement: 下方按任务 ID 导出检查点或调用 exportDraft。
    // Risk: Low。Human Review: Required
    // Original code:
    // if (!planner || selectedId === null) return;
    // const url = URL.createObjectURL(new Blob([JSON.stringify(planner.queries.exportTask(selectedId))], { type: "application/json" }));
    if (!planner || selectedId === null && plan === null) return;
    const file = selectedId === null ? planner.queries.exportDraft(getConfiguredRequest()) : planner.queries.exportTask(selectedId);
    const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: "application/json" }));
    const link = document.createElement("a");
    const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    link.href = url; link.download = `${(plan?.name || controller.blueprintDraft?.name || "eda-task").replace(/[/\\:*?"<>|]/g, "-")}_${timestamp}.eda-task.json`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const elapsed = formatPlannerElapsed(progress?.elapsedMs ?? 0, [t("eda.elapsedDay"), t("eda.elapsedHour"), t("eda.elapsedMinute"), t("eda.elapsedSecond")]);
  const rate = progress?.status !== "running" ? 0 : recentRate?.taskId === progress.taskId
    && recentRate.roundStart === progress.evaluatedProposals - progress.roundEvaluatedProposals ? recentRate.rate : null;
  const statusLabel = (status: string, taskId: string) => t(pausing && taskId === pausingTaskId ? "eda.pausing"
    : status === "running" ? "eda.running" : status === "saving" ? "eda.saving"
    : status === "failed" || status === "save-failed" ? "eda.failed" : status === "completed" ? "eda.saved" : "eda.paused");
  return <><DialogShell dialogKey="blueprint-planner" dialogState={controller.dialogState}
    title={t("eda.title")} titleId="blueprint-planner-title" closeTitle={t("action.close")}
    maximizeTitle={t("dialog.maximize")} restoreTitle={t("dialog.restore")}
    onClose={controller.close} onToggleMaximized={controller.toggleMaximized}
    onOffsetChange={controller.setOffset} onResize={compact ? undefined : controller.setSize}
    compactMobileLayout={compact} immersiveMaximized={controller.dialogState.maximized && appHost.state.screenProfile.deviceClass !== "desktop"}
    shellStyle={controller.dialogState.width === null ? { width: "min(1080px, 100%)", height: "min(760px, 100%)" } : undefined}>
    <div className={`${styles.content} ${compact ? styles.compact : ""} ${appHost.state.screenProfile.deviceClass === "tablet" ? styles.tablet : ""}`}>
      <aside className={styles.history} aria-label={t("eda.history")}>
        <button type="button" disabled={busy} onClick={openProductionPlanning}>{t("eda.newTask")}</button>
        <button type="button" disabled={busy} onClick={() => inputRef.current?.click()}>{t("eda.importTask")}</button>
        <button type="button" data-testid="eda-regression-open" onClick={regression.open}>{t("eda.regression.title")}</button>
        <input ref={inputRef} type="file" accept=".json,application/json" hidden disabled={busy} onChange={event => {
          const file = event.target.files?.[0]; event.target.value = "";
          if (!file || !planner || controller.taskLocked || fileBusy) return;
          act(async () => {
            setFileBusy(true);
            try {
              if (file.size > 100 * 1024 * 1024) throw new Error(t("eda.fileTooLarge"));
              // AI-REMOVED 2026-10-13:
              // Reason: 81MB 文本和重复解析树在主线程制造导入高峰，并与搜索堆重叠。
              // Trigger: 1GiB 内存要求；Evidence: Windows 导入峰值与主线程堆采样。
              // Replacement: readPlannerTaskFile 一次性 Worker；Risk: 保留原图配置与解析错误；Human Review: Required
              // Original code: const id = await planner.actions.importTask(JSON.parse(await file.text()) as BlueprintPlannerTaskFile);
              const id = await planner.actions.importTask(await readPlannerTaskFile(file, appHost.workspace.registry));
              controller.selectTask(id, planner.queries.getLastRequest(id) ?? undefined);
            } finally { setFileBusy(false); }
          });
        }} />
        <strong>{t("eda.history")}</strong>
        <div className={styles.taskList}>
          {history.length === 0 ? <p>{t("eda.noHistory")}</p> : history.map(task => <button type="button" key={task.taskId}
            disabled={fileBusy || anyBusy && task.taskId !== controller.activeTaskId}
            className={styles.task} aria-pressed={selectedId === task.taskId} onClick={() => select(task.taskId)}>
            {/* AI-REMOVED 2026-10-09:
              Reason: 类别和状态混排，空标题和完整时间破坏列表层级。
              Trigger: 用户确认左侧任务栏设计并要求沿用当前按钮风格。
              Evidence: 原卡片将类别与状态合为一行 11px 文本。
              Replacement: 下方标题、类别与状态行、简短时间。
              Risk: Low；交互和右侧内容不变。Human Review: Required
              Original code:
              <strong>{task.name}</strong><span>{t(task.recognizing ? "eda.identifyBlueprint" : "eda.productionMode")} · {statusLabel(task.status)}</span>
              <time>{new Date(task.startedAt).toLocaleString()}</time>
            */}
            <strong title={task.name}>{task.name}</strong>
            <span className={styles.taskMeta}>
              <span className={styles.taskCategory}>{t(task.categoryKey)}</span>
              <span className={styles.taskStatus}>{statusLabel(task.status, task.taskId)}</span>
            </span>
            <time dateTime={new Date(task.startedAt).toISOString()}>{task.timeLabel}</time>
          </button>)}
        </div>
      </aside>
      <div className={styles.main}>
        <div className={styles.scroll}>
          {controller.blueprintDraft ? <>{blueprintPlacementOptions}<BlueprintIdentification key={controller.blueprintDraft.blueprintId}
            appHost={appHost} blueprint={controller.blueprintDraft} taskId={selectedId} /></> : plan === null && progress === null ? <div className={styles.empty}><p>{t("eda.noPlan")}</p>
            <button type="button" disabled={busy} onClick={openProductionPlanning}>{t("eda.openProductionPlanning")}</button></div> : plan !== null ? <>
            <div className={styles.heading}><div><span>{t(controller.blueprintRequest ? "eda.blueprintMode" : "eda.productionMode")}</span><p className={styles.target}>{plan.name}</p></div>

            </div>
            {controller.blueprintRequest?.blueprintSource ? <BlueprintIdentification key={controller.blueprintRequest.blueprintSource.blueprint.blueprintId}
              appHost={appHost} blueprint={controller.blueprintRequest.blueprintSource.blueprint} taskId={selectedId} /> : null}
            <div className={controller.blueprintRequest ? undefined : styles.flow} aria-label={t(controller.blueprintRequest ? "eda.baselineOutputs" : "productionPlanning.modeDevice")}>
              {controller.blueprintRequest ? <ul>{plan.targets.map(target => <li key={target.itemId}>
                {t(appHost.workspace.registry.queries.findItemDefinition(target.itemId)!.nameKey)} · {target.perMinute.toFixed(2)}/min
              </li>)}</ul> : <PlannerTaskFlow key={selectedId ?? "draft"} plan={plan} registry={appHost.workspace.registry} t={t} />}
            </div>
            {supply.view && !controller.blueprintRequest ? <BlueprintPlannerEnvironment plan={plan} registry={appHost.workspace.registry} view={supply.view}
              disabled={busy || progress !== null} isTouch={appHost.state.screenProfile.hasTouch}
              onChange={controller.updateSupplyPolicy} onPickRecipe={(itemId, recipes) => act(async () => {
                const item = appHost.workspace.registry.queries.findItemDefinition(itemId);
                const recipeId = await appHost.recipePicker.pickRecipe({ includeInactiveActivityRecipes: false,
                  title: `${t("productionPlanning.chooseRecipe")} · ${item ? t(item.nameKey) : itemId}`, recipes });
                if (recipeId && controller.plan === plan && controller.viewTaskId === null) controller.updateSupplyPolicy({ itemId, source: "production", recipeId });
              })} t={t} /> : null}
            {supply.view && !controller.blueprintRequest ? <BlueprintPlannerItemPolicies plan={plan} registry={appHost.workspace.registry} environment={supply.view}
              options={controller.options} disabled={busy || progress !== null} onChange={controller.updateItemPolicy} t={t} /> : null}
            {invalidWarehouseSupply ? <p role="alert" className={styles.error}>{t("eda.portsSupplyInvalid")}</p> : null}
            {supply.error && !controller.blueprintRequest ? <p role="alert" className={styles.error}>{supply.error}</p> : null}
            {blueprintPlacementOptions}
            {!controller.blueprintRequest ? <>
              {layoutOptions}
              <fieldset className={styles.optionGroup} disabled={busy}>
                <legend>{t("eda.startupOptions")}</legend>
                <div className={styles.options}>
                  {OPTION_FIELDS.filter(field => field.key === "plantStartup").map(field => <label key={field.key}><span>{t(field.label)}</span>
                    <select disabled={placementLocked} value={controller.options[field.key]}
                      onChange={event => updatePlacementOption(field.key, event.target.value)}>
                      {field.choices.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
                    </select></label>)}
                  <label><span>{t("eda.converterStartup")}</span>
                    <select disabled={progress !== null} value={controller.options.converterStartup ?? "reject"}
                      onChange={event => controller.updateOptions({ converterStartup: event.target.value as "manual" | "tank" | "reject" })}>
                      <option value="manual">{t("eda.converterStartupManual")}</option>
                      <option value="tank">{t("eda.converterStartupTank")}</option>
                      <option value="reject">{t("eda.converterStartupReject")}</option>
                    </select></label>
                </div>
              </fieldset>
            </> : null}
            <fieldset className={styles.optionGroup} disabled={busy}>
              <legend>{t("eda.computationOptions")}</legend>
              <div className={styles.options}>
              {/* AI-REMOVED 2026-09-30: 用户批准删除时间预算；替代：下方提案预算。Risk: Low。Human Review: Required
              <label><span>{t("eda.budget")}</span><input type="number" min="10" step="10" value={controller.options.budgetMs / 1000}
                onChange={event => controller.updateOptions({ budgetMs: Number(event.target.value) * 1000 })} /></label>
              */}
              <label><span>{t("eda.evaluationsPerRound")}</span><input type="number" min="1" step="1"
                value={controller.options.evaluationsPerRound === 0 ? "" : controller.options.evaluationsPerRound / 10_000}
                onChange={event => controller.updateOptions({ evaluationsPerRound: Number(event.target.value) * 10_000 })} /></label>
              {/* AI-REMOVED 2026-10-03:
                Reason: 并发数不再由用户手填。Trigger: 用户确认自动并发。
                Evidence: Planner 自动调度与 activeWorkerCount 契约。
                Replacement: 下方自动状态输出。Risk: Low。Human Review: Required
                Original code:
              <label><span>{t("eda.concurrency")}</span><input type="number" min="1" max="32" step="1"
                value={controller.options.concurrency ?? 1}
                aria-describedby={warnConcurrency ? "eda-concurrency-warning" : undefined}
                onChange={event => controller.updateOptions({ concurrency: Number(event.target.value) })} />
                {warnConcurrency ? <span id="eda-concurrency-warning" role="status" className={styles.error}>
                  {t("eda.concurrencyWarning").replace("{cores}", String(hardwareConcurrency))}
                </span> : null}</label>
              */}
              {/* AI-REMOVED 2026-10-03:
                Reason: 只读并发数不能切换单 Worker，而且搜索与验证交替会显示 0/1。
                Trigger: 用户要求 CPU+GPU 复选框。Evidence: Windows 真机决策记录。
                Replacement: 下方复选框。Risk: Low。Human Review: Required
                Original code:
              <label><span>{t("eda.concurrency")}</span><output>
                {progress?.status === "running" ? t("eda.activeConcurrency").replace("{count}", String(progress.activeWorkerCount ?? 0))
                  : t("eda.autoConcurrency")}
              </output></label>
              */}
              </div>
              <div className={styles.acceleration}>
                <label className={styles.parallel}><span>{t("eda.concurrency")}</span><input type="checkbox" role="switch" checked={controller.options.concurrency === "auto"}
                  onChange={event => controller.updateOptions({ concurrency: event.target.checked ? "auto" : 1 })} /></label>
                <label className={styles.parallel}><span>{t("eda.gpu")}</span><input type="checkbox" role="switch" checked={controller.options.gpu === true}
                  onChange={event => controller.updateOptions({ gpu: event.target.checked })} /></label>
              </div>
            </fieldset>
            {plan.containsModules ? <p role="alert" className={styles.error}>{t("eda.modulesUnsupported")}</p> : null}
          </> : null}
          {progress !== null ? <section className={styles.progress} aria-live="polite">
            <div className={styles.statistics}>
              <span>{statusLabel(progress.status, progress.taskId)}</span>
              {randomSeed !== null ? <span>{t("eda.randomSeed")} <strong>{randomSeed}</strong></span> : null}
              <span>{t("eda.elapsed")} <strong>{elapsed}</strong></span>
              {progress.phase !== "identification" ? <span>{t("eda.candidates")} <strong>{progress.candidateCount}</strong></span> : null}
              {progress.bestArea !== null ? <span>{t("eda.bestArea")} <strong>{progress.bestArea}</strong></span> : null}
              {progress.bestArea === null && progress.initialArea !== undefined ? <span>{t("eda.initialArea")} <strong>{progress.initialArea}</strong></span> : null}
            </div>
            {busy ? <progress aria-label={t("eda.progress")} max={1} value={progress.estimatedProgress ?? undefined} /> : null}
            {progress.phase !== "identification" ? <div className={styles.statistics}>
              <span>{t("eda.roundProposals")} <strong>{progress.roundEvaluatedProposals.toLocaleString()} / {planner?.queries.getLastRequest(progress.taskId)?.options.evaluationsPerRound.toLocaleString()}</strong>{" "}
                <span className={styles.proposalRate} title={t("eda.recentRate")}>({rate === null ? "—" : rate.toLocaleString()} {t("eda.proposalsPerSecond")})</span></span>
              <span>{t("eda.totalProposals")} <strong>{progress.evaluatedProposals.toLocaleString()}</strong>{" "}
                <span className={styles.proposalRate} title={t("eda.averageRate")}>({plannerProposalRate(progress.evaluatedProposals, progress.elapsedMs).toLocaleString()} {t("eda.proposalsPerSecond")})</span></span>
            </div> : null}
            <p>{pausing ? t("eda.notifyingWorkers") : progress.message}</p>
            {progress.initialArea !== undefined || progress.areaHistory?.length ? <AreaCurve points={progress.areaHistory ?? []} initialArea={progress.initialArea}
              proposals={progress.evaluatedProposals} label={t("eda.areaCurve")}
              xLabel={`${t("eda.totalProposals")}${t("eda.logScale")}`} yLabel={t("eda.area")}
              initialLabel={t("eda.initialArea")} verifiedLabel={t("eda.bestArea")} /> : null}
            {result !== null ? <p>{result.metrics.width} × {result.metrics.height} · {result.metrics.productionDeviceCount} {t("eda.devices")}
              {result.metrics.gasDiffuserCount > 0 ? ` · ${t("eda.environmentCount").replace("{count}", String(result.metrics.gasDiffuserCount))}` : ""}</p> : null}
          </section> : null}
          {controller.blueprintCreationError ? <p role="alert" className={styles.error}>{controller.blueprintCreationError}</p> : null}
          {error !== null ? <p role="alert" className={styles.error}>{error}</p> : null}
        </div>
        <footer className={styles.footer}>
          {selectedId !== null || plan !== null ? <div className={styles.taskActions}>
            <button type="button" disabled={!planner || fileBusy} onClick={download}>{t("eda.downloadTask")}</button>
            {/* AI-REMOVED 2026-10-08:
              Reason: EDA 删除确认必须使用项目弹窗模块。
              Trigger: 用户指出系统弹窗破坏项目交互一致性。
              Evidence: 原按钮直接调用 window.confirm；DialogShell 已提供遮罩、叠层和 Escape 关闭。
              Replacement: 本文件 PlannerTaskDeleteButton 与下方删除处理器。
              Risk: 确认改为异步交互，需核验任务 ID 和运行锁。Human Review: Required
              Original code:
              {selectedId !== null ? <button type="button" disabled={busy || fileBusy} onClick={() => act(async () => {
                if (!planner || !window.confirm(t("eda.confirmDelete"))) return;
                setFileBusy(true);
                try {
                  await planner.actions.deleteTask(selectedId);
                  const next = planner.queries.listTasks()[0];
                  if (next) select(next.taskId); else controller.selectTask(null);
                } finally { setFileBusy(false); }
              })}>{t("eda.deleteTask")}</button> : null}
            */}
            {selectedId !== null ? <PlannerTaskDeleteButton key={selectedId} disabled={busy} t={t} onConfirm={() => act(async () => {
              if (!planner || controller.taskLocked || fileBusy || controller.viewTaskId !== selectedId) return;
              setFileBusy(true);
              try {
                await planner.actions.deleteTask(selectedId);
                const next = planner.queries.listTasks()[0];
                if (next) select(next.taskId); else controller.selectTask(null);
              } finally { setFileBusy(false); }
            })} /> : null}
          </div> : null}
          <div className={styles.planningActions}>
            {recognition && selectedId !== null ? <button type="button" className={styles.primary}
              disabled={busy || invalidBlueprintSupply || !recognition.detectedBoundaries || !recognition.input.boundaries.length
                || recognition.input.boundaries.some(boundary => boundary.direction === "input" && !boundary.itemId)}
              onClick={() => act(async () => {
                await planner!.actions.identifyBlueprint(selectedId);
                controller.selectTask(selectedId, planner!.queries.getLastRequest(selectedId) ?? undefined);
              })}>{t(progress?.status === "running" ? "eda.identifyingBlueprint" : "eda.identifyBlueprint")}</button> : null}

            {progress !== null && (plan !== null || recognition !== null) && !busy ? <button type="button" disabled={anyBusy}
              onClick={() => act(async () => {
                setFileBusy(true);
                try { await controller.duplicateTask(); } finally { setFileBusy(false); }
              })}>{t("eda.replan")}</button> : null}
            {progress !== null && (progress.status === "running" || pausing) ? <button type="button" disabled={pausing} onClick={() => act(() => {
              if (!planner || pausing) return;
              setPausingTaskId(progress.taskId);
              try { planner.actions.cancel(progress.taskId); }
              catch (failure) { setPausingTaskId(null); throw failure; }
            })}>{t(pausing ? "eda.pausing" : "eda.pause")}</button> : null}
            {progress !== null && plan !== null && !busy ? <button type="button" disabled={!validRoundSettings || anyBusy || invalidWarehouseSupply}
              onClick={() => act(async () => {
                if (!planner || busy || anyBusy) return;
                const options = toJS(controller.options);
                if (controller.blueprintRequest && !planningStarted) {
                  setFileBusy(true);
                  try {
                    const configured = { ...options, blueprintOptimizations: {
                      ...(options.blueprintOptimizations ?? DEFAULT_BLUEPRINT_OPTIMIZATIONS),
                    } };
                    await planner.actions.updateBlueprintOptions(progress.taskId, configured);
                    controller.updateOptions(configured);
                    await planner.actions.continuePlanning(progress.taskId,
                      configured.evaluationsPerRound, configured.concurrency, configured.gpu);
                  } finally { setFileBusy(false); }
                } else await planner.actions.continuePlanning(progress.taskId,
                  options.evaluationsPerRound, options.concurrency, options.gpu);
              })}>{t(planningStarted ? "eda.continue" : "eda.start")}</button> : null}
            {result !== null ? <>
              <button type="button" onClick={() => {
                appHost.blueprintPreview.open({ ...result.blueprint, parentFolderId: result.folderId }, { canDelete: false });
                // AI-REMOVED 2026-09-30:
                // Reason: 改为提案预算与真实累计计数，预览保留任务窗口。
                // Trigger: 用户批准本轮接口与交互调整。
                // Evidence: 原实现使用时间截止或关闭任务面板。
                // Replacement: 保留规划面板，由预览窗口管理自身关闭
                // Risk: Low。Human Review: Required
                // Original code:
                // controller.close();

              }}>{t("eda.preview")}</button>
              <button type="button" className={styles.primary} disabled={busy || result.folderId !== null}
                onClick={() => act(() => planner?.actions.save(result.taskId))}>{t(progress?.status === "save-failed" ? "eda.retrySave" : "eda.save")}</button>
              <button type="button" onPointerUp={event => place(event.pointerType === "mouse" ? "mouse" : "touch")}
                onClick={event => { if (event.detail === 0) place("mouse"); }}>{t("eda.place")}</button>
            </> : null}
            {progress === null && plan !== null ? <button type="button" className={styles.primary}
              disabled={plan.containsModules || !planner || busy || !validRoundSettings || invalidWarehouseSupply || Boolean(supply.error) || Boolean(supply.view?.issues.length)} onClick={() => act(() => {
                if (planner) {
                  // AI-REMOVED 2026-10-04:
                  // Reason: 启动与下载共用可见配置的整理逻辑。
                  // Trigger: 用户要求草稿下载包含当前任务及配置。
                  // Evidence: 原逐物品与环境规则只在启动点击处理器中固化。
                  // Replacement: 本组件 getConfiguredRequest。
                  // Risk: Low；环境视图无效时导出保留原规则，启动仍按原条件禁用。
                  // Human Review: Required
                  // Original code:
                  // const request = controller.getRequest();
                  // // 保存当前可见路线的确定选择，隐藏上游不成为额外的供给授权。
                  // const supplyPolicies = supply.view?.rows.flatMap(row => !row.inherited && row.policy ? [row.policy] : []) ?? [];
                  // const rules = new PlannerItemRules(appHost.workspace.registry, request.options);
                  // const itemPolicies = supply.view ? collectPlannerItemBoundaries(appHost.workspace.registry, request.plan, supply.view).map(row => ({
                  //   itemId: row.itemId, ...(row.supply ? { supply: rules.supply(row.itemId) } : {}),
                  //   ...(row.output && rules.isSolid(row.itemId) ? { output: rules.output(row.itemId) } : {}),
                  //   ...(row.byproducts ? { byproducts: rules.byproducts(row.itemId) } : {}),
                  // })) : request.options.itemPolicies;
                  // select(planner.actions.start({ ...request, plan: { ...request.plan, supplyPolicies }, options: { ...request.options, itemPolicies } }));
                  select(planner.actions.start(getConfiguredRequest()));
                }
              })}>{t("eda.start")}</button> : null}
          </div>
        </footer>
      </div>
    </div>
  </DialogShell>
  <DialogShell dialogKey="eda-regression" dialogState={{ ...regressionDialog, visible: regression.visible }}
    title={t("eda.regression.title")} titleId="eda-regression-title" closeTitle={t("action.close")}
    maximizeTitle="" restoreTitle="" showMaximizeButton={false} onClose={regression.close} onToggleMaximized={() => {}}
    compactMobileLayout={compact} shellStyle={{ width: "min(820px, 100%)", height: "min(640px, 100%)" }}>
    <EdaRegressionPanel controller={regression} unavailable={!planner || planner.state.activeTaskId !== null || fileBusy} translate={t} />
  </DialogShell></>;
});

// AI-REMOVED 2026-09-30:
// Reason: 单面板改为任务历史、设备流向图与未保存结果操作。
// Trigger: 用户授权任务化规划界面。
// Evidence: 原组件只展示 latest 单任务，不支持历史选择与导入导出。
// Replacement: 本文件 BlueprintPlannerDialog。
// Risk: Low；沿用 DialogShell 和规划契约。
// Human Review: Required
// Original code:
// import { useEffect, useMemo, useState } from "react";
// import { observer } from "mobx-react-lite";
// import type { BlueprintPlannerOptions } from "@/domain/blueprint-planner";
// import type { UiKey } from "@/shared/i18n";
// import type { AppHost } from "../host";
// import { enterBlueprintPlacement } from "../input";
// import { DialogShell } from "./shared/dialog-shell";
// import styles from "./blueprint-planner-dialog.module.scss";
//
// const OPTION_FIELDS: readonly { key: Exclude<keyof BlueprintPlannerOptions, "budgetMs" | "evaluationsPerRound">; label: UiKey; choices: readonly [string, UiKey][] }[] = [
//   { key: "solidSupply", label: "eda.solidSupply", choices: [["external", "eda.externalBelt"], ["warehouse", "eda.warehouseSupply"]] },
//   { key: "fluidSupply", label: "eda.fluidSupply", choices: [["external", "eda.externalPipe"], ["conduit", "eda.conduitSupply"]] },
//   { key: "warehouseBus", label: "eda.warehouseBus", choices: [["straight", "eda.straight"], ["free", "eda.free"]] },
//   { key: "solidOutput", label: "eda.solidOutput", choices: [["auto", "eda.autoOutput"], ["warehouse", "eda.warehouseOutput"], ["stash", "eda.stashOutput"]] },
//   { key: "byproducts", label: "eda.byproducts", choices: [["output", "eda.output"], ["destroy", "eda.destroy"]] },
//   { key: "plantStartup", label: "eda.plantStartup", choices: [["preload", "eda.preload"], ["warehouse", "eda.warehouseStartup"]] },
// ];
//
// export const BlueprintPlannerDialog = observer(function BlueprintPlannerDialog({ appHost }: { appHost: AppHost }) {
//   const controller = appHost.blueprintPlannerDialog;
//   const planner = appHost.workspace.blueprintPlanner;
//   const t = appHost.actions.translate;
//   const [, refresh] = useState(0);
//   const [error, setError] = useState<string | null>(null);
//   useEffect(() => {
//     if (!controller.dialogState.visible) return;
//     const interval = setInterval(() => refresh((value) => value + 1), 250);
//     return () => clearInterval(interval);
//   }, [controller.dialogState.visible]);
//   const latest = planner?.queries.getTask() ?? null;
//   const progress = latest?.taskId === controller.viewTaskId ? latest : null;
//   const plannerRevision = planner?.state.revision ?? 0;
//   const result = useMemo(() => {
//     void plannerRevision;
//     return progress === null ? null : planner?.queries.getResult(progress.taskId) ?? null;
//   }, [planner, plannerRevision, progress]);
//   if (!controller.dialogState.visible) return null;
//   const busy = progress !== null && ["running", "saving"].includes(progress.status);
//   const compact = appHost.state.screenProfile.deviceClass === "mobile";
//   const plan = controller.plan;
//   const validRoundSettings = Number.isFinite(controller.options.budgetMs) && controller.options.budgetMs > 0
//     && Number.isSafeInteger(controller.options.evaluationsPerRound) && controller.options.evaluationsPerRound >= 1_000
//     && controller.options.evaluationsPerRound % 1_000 === 0;
//   const act = (action: () => void) => {
//     setError(null);
//     try { action(); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
//   };
//   const start = () => act(() => {
//     if (planner === null) throw new Error(t("eda.unavailable"));
//     controller.selectTask(planner.actions.start(controller.getRequest()));
//   });
//   const openProductionPlanning = () => {
//     controller.close();
//     appHost.internalActions.setDialogTab("toolbox", "production-planning");
//     appHost.internalActions.openDialog("toolbox");
//   };
//   const place = (source: "mouse" | "touch") => act(() => {
//     const editor = appHost.workspace.editor;
//     if (result === null || editor === null) return;
//     const entered = enterBlueprintPlacement({
//       appHost, editor, record: { ...result.blueprint, parentFolderId: result.folderId },
//       source, initialMousePosition: null,
//     });
//     if (entered.status === "handled") controller.close();
//     else setError(t("eda.placeFailed"));
//   });
//   const elapsed = Math.floor((progress?.elapsedMs ?? 0) / 1000);
//   return (
//     <DialogShell dialogKey="blueprint-planner" dialogState={controller.dialogState}
//       title={t("eda.title")} titleId="blueprint-planner-title" closeTitle={t("action.close")}
//       maximizeTitle={t("dialog.maximize")} restoreTitle={t("dialog.restore")}
//       onClose={controller.close} onToggleMaximized={controller.toggleMaximized}
//       onOffsetChange={controller.setOffset} onResize={compact ? undefined : controller.setSize}
//       compactMobileLayout={compact} immersiveMaximized={controller.dialogState.maximized && appHost.state.screenProfile.deviceClass !== "desktop"}
//       shellStyle={controller.dialogState.width === null ? { width: "min(660px, 100%)", height: "min(600px, 100%)" } : undefined}>
//       <div className={`${styles.content} ${compact ? styles.compact : ""}`}>
//         <div className={styles.scroll}>
//           {plan === null && progress === null ? <div className={styles.empty}>
//             <p>{t("eda.noPlan")}</p>
//             <button type="button" onClick={openProductionPlanning}>{t("eda.openProductionPlanning")}</button>
//           </div> : <>
//             <p className={styles.target}>{plan.name || plan.targets.map((flow) => {
//               const item = appHost.workspace.registry.queries.findItemDefinition(flow.itemId);
//               return `${item === null ? flow.itemId : t(item.nameKey)} ${flow.perMinute}/min`;
//             }).join(" · ")}</p>
//             <fieldset className={styles.options} disabled={progress?.status === "running" || progress?.status === "saving"}>
//               {OPTION_FIELDS.map((field) => <label key={field.key}>
//                 <span>{t(field.label)}</span>
//                 <select disabled={busy || progress !== null} value={controller.options[field.key]} onChange={(event) => controller.updateOptions({ [field.key]: event.target.value })}>
//                   {field.choices.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
//                 </select>
//               </label>)}
//               <label><span>{t("eda.budget")}</span>
//                 <input type="number" min="10" step="10" value={controller.options.budgetMs / 1000}
//                   onChange={(event) => controller.updateOptions({ budgetMs: Number(event.target.value) * 1000 })} />
//               </label>
//               <label><span>{t("eda.evaluationsPerRound")}</span>
//                 <input type="number" min="1000" step="1000" value={controller.options.evaluationsPerRound}
//                   onChange={(event) => controller.updateOptions({ evaluationsPerRound: Number(event.target.value) })} />
//               </label>
//             </fieldset>
//             {plan.containsModules ? <p role="alert" className={styles.error}>{t("eda.modulesUnsupported")}</p> : null}
//           </>}
//           {progress !== null ? <section className={styles.progress} aria-live="polite">
//             <div className={styles.statistics}>
//               <span>{t("eda.elapsed")} <strong>{`${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`}</strong></span>
//               <span>{t("eda.candidates")} <strong>{progress.candidateCount}</strong></span>
//               {progress.bestArea !== null ? <span>{t("eda.bestArea")} <strong>{progress.bestArea}</strong></span> : null}
//             </div>
//             {busy ? <progress aria-label={t("eda.progress")} max={1} value={progress.estimatedProgress ?? undefined} /> : null}
//             <p>{progress.message}</p>
//             {result !== null ? <p>{result.metrics.width} × {result.metrics.height} · {result.metrics.productionDeviceCount} {t("eda.devices")}</p> : null}
//           </section> : null}
//           {error !== null ? <p role="alert" className={styles.error}>{error}</p> : null}
//         </div>
//         <footer className={styles.footer}>
//           {progress?.status === "running" || progress?.status === "waiting" ? <button type="button" onClick={() => act(() => planner?.actions.cancel(progress.taskId))}>{t("action.cancel")}</button> : null}
//           {progress !== null && ["waiting", "completed"].includes(progress.status) ? <button type="button"
//             disabled={!validRoundSettings}
//             onClick={() => act(() => planner?.actions.continuePlanning(progress.taskId, controller.options.budgetMs, controller.options.evaluationsPerRound))}>{t("eda.continue")}</button> : null}
//           {progress?.bestArea !== null && progress?.bestArea !== undefined ? <button type="button" className={styles.primary}
//             disabled={progress.status !== "waiting"}
//             onClick={() => {
//               setError(null);
//               void planner?.actions.save(progress.taskId).catch((failure: unknown) => setError(String(failure)));
//             }}>{t("eda.save")}</button> : null}
//           {progress?.status === "save-failed" ? <button type="button" className={styles.primary} onClick={() => {
//             setError(null);
//             void planner?.actions.retrySave(progress.taskId).catch((failure: unknown) => setError(String(failure)));
//           }}>{t("eda.retrySave")}</button> : null}
//           {!busy && plan !== null && (progress === null || ["cancelled", "failed"].includes(progress.status)) ? <button type="button"
//             disabled={plan.containsModules || planner === null || !validRoundSettings}
//             className={result === null ? styles.primary : undefined} onClick={start}>{t(progress === null ? "eda.start" : "eda.replan")}</button> : null}
//           {result !== null ? <button type="button" className={styles.primary}
//             onPointerUp={(event) => place(event.pointerType === "mouse" ? "mouse" : "touch")}
//             onClick={(event) => { if (event.detail === 0) place("mouse"); }}>
//             {t("eda.place")}
//           </button> : null}
//         </footer>
//       </div>
//     </DialogShell>
//   );
// });


// AI-REMOVED 2026-10-13:
// Reason: 首次启动不再通过额外弹窗配置权限。
// Trigger: 用户确认页面内一体布局 A。
// Evidence: 原 DialogShell、取消和确认按钮只服务于优化权限弹窗。
// Replacement: blueprintPlacementOptions 与底部开始规划入口。
// Risk: Low；保留原有持久化、默认关闭和首次规划锁定语义。
// Human Review: Required
//
// Original code:
//     <DialogShell dialogKey="eda-blueprint-optimizations"
//       dialogState={{ ...optimizationDialogState, visible: optimizationTaskId !== null && optimizationTaskId === selectedId && !planningStarted }}
//       title={t("eda.optimizationsTitle")} titleId="eda-optimizations-title" closeTitle={t("action.close")}
//       maximizeTitle="" restoreTitle="" showMaximizeButton={false}
//       shellStyle={{ width: "min(680px, 100%)", height: "auto", minHeight: 0, maxHeight: "100%" }}
//       bodyClassName={styles.optimizationBody} onClose={() => setOptimizationTaskId(null)} onToggleMaximized={() => {}}>
//       <div className={styles.optimizationChoices}>
//         {(["reassignPorts", "reassignConnections", "rebuildLogistics", "mergeBoundaryFacilities"] as const).map(key => <label key={key} className={styles.optimizationChoice}>
//           <span><strong>{t(`eda.optimization.${key}`)}</strong><small id={`eda-${key}-description`}>{t(`eda.optimization.${key}.description`)}</small></span>
//           <input type="checkbox" role="switch" aria-label={t(`eda.optimization.${key}`)} aria-describedby={`eda-${key}-description`}
//             checked={(controller.options.blueprintOptimizations ?? DEFAULT_BLUEPRINT_OPTIMIZATIONS)[key]} disabled={busy}
//             onChange={event => {
//               const checked = event.currentTarget.checked;
//               act(async () => {
//                 if (!planner || !selectedId || planningStarted || busy) return;
//                 setFileBusy(true);
//                 const previous = toJS(controller.options);
//                 try {
//                   const options = { ...toJS(controller.options), blueprintOptimizations: {
//                     ...(controller.options.blueprintOptimizations ?? DEFAULT_BLUEPRINT_OPTIMIZATIONS), [key]: checked,
//                   } };
//                   controller.updateOptions(options);
//                   await planner.actions.updateBlueprintOptions(selectedId, options);
//                   if (controller.viewTaskId === selectedId) controller.updateOptions(options);
//                 } catch (failure) {
//                   if (controller.viewTaskId === selectedId) controller.updateOptions(previous);
//                   throw failure;
//                 } finally { setFileBusy(false); }
//               });
//             }} />
//         </label>)}
//       </div>
//       {error !== null ? <p role="alert" className={styles.error}>{error}</p> : null}
//       <div className={styles.optimizationActions}>
//         <button type="button" onClick={() => setOptimizationTaskId(null)}>{t("action.cancel")}</button>
//         <button type="button" disabled={busy || !validRoundSettings || invalidWarehouseSupply} onClick={() => act(async () => {
//           if (!planner || !selectedId || selectedId !== optimizationTaskId || busy || planningStarted) return;
//           setFileBusy(true);
//           try {
//             const options = { ...toJS(controller.options), blueprintOptimizations: {
//               ...(controller.options.blueprintOptimizations ?? DEFAULT_BLUEPRINT_OPTIMIZATIONS),
//             } };
//             await planner.actions.updateBlueprintOptions(selectedId, options);
//             controller.updateOptions(options);
//             setOptimizationTaskId(null);
//             await planner.actions.continuePlanning(selectedId, options.evaluationsPerRound, options.concurrency, options.gpu);
//           } finally { setFileBusy(false); }
//         })}>{t("eda.start")}</button>
//       </div>
//     </DialogShell>

// AI-REMOVED 2026-10-13:
// Reason: 识别页与优化页统一复用摆放规则及四项权限区。
// Trigger: 用户要求四项优化与两项摆放规则组成一体。
// Evidence: 原识别页只包含两项规则，重复渲染且没有优化权限区。
// Replacement: blueprintPlacementOptions。
// Risk: Low；保留原有持久化、默认关闭和首次规划锁定语义。
// Human Review: Required
//
// Original code:
//           {controller.blueprintDraft ? <><fieldset className={styles.options} disabled={busy}>
//             {OPTION_FIELDS.filter(field => field.key !== "plantStartup").map(field => <label key={field.key}><span>{t(field.label)}</span>
//               {/* AI-REMOVED 2026-10-11:
//                 Reason: 识别阶段和识别后的摆放配置共用保存入口。
//                 Trigger: 用户要求首次开始规划时才锁定摆放规则。
//                 Evidence: 原 onChange 只在识别页保存，优化页只修改控制器草稿。
//                 Replacement: updatePlacementOption。
//                 Risk: 保存期间临时禁用操作；保存失败保留原配置。Human Review: Required
//                 Original code:
//                 onChange={event => {
//                   const value = event.target.value;
//                   act(async () => {
//                     if (!planner || selectedId === null || busy) return;
//                     setFileBusy(true);
//                     try {
//                       const options = { ...toJS(controller.options), [field.key]: value };
//                       if (options.warehousePortPlacement === "full-side") options.warehouseBus = "straight";
//                       await planner.actions.updateBlueprintOptions(selectedId, options);
//                       controller.updateOptions(options);
//                     } finally { setFileBusy(false); }
//                   });
//                 }}
//               */}
//               <select value={controller.options[field.key]}
//                 disabled={field.key === "warehouseBus" && controller.options.warehousePortPlacement === "full-side"}
//                 onChange={event => updatePlacementOption(field.key, event.target.value)}>
//                 {field.choices.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
//               </select></label>)}
//           </fieldset>

// AI-REMOVED 2026-10-13:
// Reason: 开始按钮直接持久化默认权限后启动规划。
// Trigger: 用户要求取消开始后的确认弹窗。
// Evidence: 原分支仅设置 optimizationTaskId，需再次确认才执行。
// Replacement: 下方按钮的异步启动处理。
// Risk: Low；保留原有持久化、默认关闭和首次规划锁定语义。
// Human Review: Required
//
// Original code:
//               onClick={() => {
//                 if (controller.blueprintRequest && !planningStarted) setOptimizationTaskId(progress.taskId);
//                 else act(() => planner?.actions.continuePlanning(progress.taskId,
//                   controller.options.evaluationsPerRound, controller.options.concurrency, controller.options.gpu));
//               }
