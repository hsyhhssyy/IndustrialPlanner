import { useMemo } from "react";
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
  const recipeId = state?.transition.kind === "recipe-completed" ? state.transition.recipeId : undefined;
  const recipe = useMemo(() => recipeId === undefined ? undefined : recipes.find((entry) => entry.id === recipeId), [recipeId, recipes]);
  const channel = machine === undefined ? null : runtimeStatus?.channelRecipes[machine.channelId] ?? null;
  const timed = state?.transition.kind === "elapsed";
  const clock = useSimulationRecipePresentation(runtimeSample, runtime !== undefined && (timed || channel?.isProgressing === true));
  if (state === undefined || machine === undefined) return null;
  const duration = state.transition.kind === "elapsed"
    ? state.transition.durationSeconds : recipe?.durationSeconds ?? 0;
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

  return (
    <InspectorCollapsiblePanel title="设备状态" dataInspectorKey="device-state" bodyClassName={styles["device-state-body"]}>
      <div className={styles["device-state-heading"]}>
        <span className={styles["device-state-name"]}>
          <strong>{translate(state.nameKey)}</strong>
          <span className={styles["device-state-status"]}>{status}</span>
        </span>
        <span>阶段 {stateIndex + 1} / {machine.states.length}</span>
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
    </InspectorCollapsiblePanel>
  );
}
