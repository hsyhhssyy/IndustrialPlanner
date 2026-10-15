import { useMemo } from "react";
import { resolvePresentedRecipeProgressSeconds } from "@/shared/simulation-recipe-progress";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import type { SimulationDeviceRuntimeStatusReadModel } from "@/domain/simulation/types/simulation-types";
import { InspectorCollapsiblePanel } from "./inspector-collapsible-panel";
import type { InspectorRuntimeSample } from "./selection-inspector-model";
import { useSimulationRecipePresentation } from "./use-simulation-recipe-presentation";
import { resolveDeviceStateProgressSeconds } from "./device-state-progress";
import styles from "./inspector.module.scss";

export function DeviceStateInspector({ definition, runtimeStatus, runtimeSample, recipes, translate }: {
  definition: EntityDefinition;
  runtimeStatus: SimulationDeviceRuntimeStatusReadModel | null;
  runtimeSample: InspectorRuntimeSample | null;
  recipes: readonly RecipeDefinition[];
  translate: (key: string) => string;
}) {
  const machine = definition.stateMachine;
  const runtime = runtimeStatus?.deviceState;
  const stateId = runtime?.stateId ?? machine?.initialStateId;
  const stateIndex = machine?.states.findIndex((entry) => entry.id === stateId) ?? -1;
  const state = machine?.states[stateIndex];
  const recipeId = state?.enterRecipeId;
  const recipe = useMemo(() => recipeId === undefined ? undefined : recipes.find((entry) => entry.id === recipeId), [recipeId, recipes]);
  const channel = machine === undefined ? null : runtimeStatus?.channelRecipes[machine.channelId] ?? null;
  const timed = runtime?.endsAtSeconds != null || state?.timerDurationSeconds !== undefined;
  const clock = useSimulationRecipePresentation(runtimeSample, runtime !== undefined && (timed || channel?.isProgressing === true));
  if (state === undefined || machine === undefined) return null;
  const duration = timed ? runtime?.endsAtSeconds != null && runtime.timerStartedAtSeconds !== null
    ? runtime.endsAtSeconds - runtime.timerStartedAtSeconds : state.timerDurationSeconds ?? 0 : recipe?.durationSeconds ?? 0;
  const progress = Math.min(duration, resolveDeviceStateProgressSeconds(state, runtime, channel, clock));
  const percent = duration > 0 ? progress / duration * 100 : 0;
  const remaining = Math.max(0, Math.ceil(duration - progress));
  const waiting = !timed && channel?.isProgressing !== true;
  const status = runtime === undefined ? "未开始"
    : channel?.state === "waiting-output" ? "等待输出"
    : waiting && (runtimeStatus?.powerStatus === "out-of-power-range"
      || (definition.requiresPower && clock.documentStatus?.isPowerOutage)) ? "等待供电"
    : waiting && recipe?.requiredEnvironmentAnyOf?.length ? "等待环境"
    : clock.simulationState?.runningState === "pause" ? "已暂停"
    : waiting ? "等待启动" : "进行中";

  const cultivation = definition.cultivation;
  const cultivationState = runtimeStatus?.cultivation;
  const refined = cultivation?.refinedStateIds.includes(state.id) === true;
  const cultivationRecipeId = machine.states.find(entry => cultivation?.growingStateIds.includes(entry.id) && entry.enterRecipeId)?.enterRecipeId;
  const cultivationRecipe = recipes.find(entry => entry.id === cultivationRecipeId);
  const cultivationChannel = channel?.recipeId === cultivationRecipeId ? channel : null;
  const cultivationProgress = refined ? cultivationRecipe?.durationSeconds ?? 0
    : cultivationChannel ? resolvePresentedRecipeProgressSeconds({ channelStatus: cultivationChannel, ...clock }) ?? 0 : 0;
  const cultivationStatus = refined ? "已完成" : !cultivation?.growingStateIds.includes(state.id) ? "等待生长"
    : clock.simulationState?.runningState === "pause" ? "已暂停" : cultivationChannel?.isProgressing ? "进行中" : "等待息壤环境";

  return (
    <InspectorCollapsiblePanel title="设备状态" dataInspectorKey="device-state" bodyClassName={styles["device-state-body"]}>
      <div className={styles["device-state-heading"]}>
        <span className={styles["device-state-name"]}>
          <strong>{translate(state.nameKey)}</strong>
          <span className={styles["device-state-status"]}>{status}</span>
        </span>
        {/* AI-REMOVED 2026-10-15:
          Reason: 分支状态数组位置不能表示种植阶段序号。
          Trigger: 普通成长可转向成熟或育种后成长。
          Evidence: 有序 transitions 包含互斥路径。
          Replacement: 当前状态名称和独立进度条。
          Risk: Low
          Human Review: Required
          Original code: <span>阶段 {stateIndex + 1} / {machine.states.length}</span>
        */}
      </div>
      <div className={styles["progress-bar"]} role="progressbar" aria-label="当前阶段进度"
        aria-valuemin={0} aria-valuemax={duration} aria-valuenow={progress}>
        <div className={styles["progress-track"]}>
          <div className={styles["progress-fill"]} style={{ width: `${percent}%` }} />
        </div>
        <span className={styles["progress-percent"]}>{Math.floor(percent)}%</span>
      </div>
      <div className={styles["device-state-detail"]}>
        <span>{Math.floor(progress)} / {duration} 秒</span>
        <span>剩余 {remaining} 秒</span>
      </div>
      {cultivation && cultivationRecipe && <>
        <div className={styles["device-state-detail"]}><strong>{translate(cultivationRecipe.nameKey)}</strong><span>{cultivationStatus}</span></div>
        <div className={styles["progress-bar"]} role="progressbar" aria-label="优质培育进度"
          aria-valuemin={0} aria-valuemax={cultivationRecipe.durationSeconds} aria-valuenow={cultivationProgress}>
          <div className={styles["progress-track"]}><div className={styles["progress-fill"]}
            style={{ width: `${Math.min(100, cultivationProgress / cultivationRecipe.durationSeconds * 100)}%` }} /></div>
          <span className={styles["progress-percent"]}>{Math.floor(cultivationProgress)} / {cultivationRecipe.durationSeconds} 秒</span>
        </div>
        <div className={styles["device-state-detail"]}><strong>相接增产 +{Math.round((cultivationState?.yieldBonusRatio ?? 0) * 100)}%</strong>
          <span>相接 {cultivationState?.adjacentPlotCount ?? 0} 块 · 有效 {cultivationState?.effectiveNeighborCount ?? 0} 块</span></div>
        <div className={styles["device-state-detail"]}><span>相接培育 {Math.floor(cultivationState?.neighborProgressSeconds ?? 0)} / {cultivation.neighborDurationSeconds} 秒</span>
          <span>{(cultivationState?.neighborProgressSeconds ?? 0) >= cultivation.neighborDurationSeconds ? "已完成"
            : clock.simulationState?.runningState === "pause" ? "已暂停" : cultivationState?.isNeighborProgressing ? "进行中" : "等待有效邻田"}</span></div>
      </>}
    </InspectorCollapsiblePanel>
  );
}
