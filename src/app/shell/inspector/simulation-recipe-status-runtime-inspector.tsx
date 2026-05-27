import type {
  SimulationDeviceRuntimeStatusReadModel,
} from "@/domain/simulation/types/simulation-types";
import type { ProductionPlanningIndex } from "@/app/shell/production-planning/production-planning-model";
import { RecipeDisplay } from "@/app/shell/shared/recipe-display";
import styles from "@/app/shell/inspector/inspector.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

export const SIMULATION_RECIPE_STATUS_RUNTIME_INSPECTOR_KEY =
  "simulation-recipe-status-runtime-inspector";

export function resolveSimulationRuntimeProgressPercent(
  runtimeStatus: SimulationDeviceRuntimeStatusReadModel | null,
): number | null {
  if (runtimeStatus === null) {
    return null;
  }

  const { desiredSeconds, progressSeconds } = runtimeStatus;
  if (progressSeconds === null || desiredSeconds === null || desiredSeconds <= 0) {
    return null;
  }

  const progressPercent = progressSeconds / desiredSeconds * 100;
  if (!Number.isFinite(progressPercent)) {
    return null;
  }

  return Math.max(0, Math.min(100, progressPercent));
}

export interface SimulationRecipeStatusRuntimeInspectorProps {
  channelId: string;
  runtimeStatus: SimulationDeviceRuntimeStatusReadModel | null;
  index: ProductionPlanningIndex;
  t: (key: string) => string;
}

export function SimulationRecipeStatusRuntimeInspector({
  channelId,
  runtimeStatus,
  index,
  t,
}: SimulationRecipeStatusRuntimeInspectorProps) {
  const recipeId = runtimeStatus?.recipeId ?? null;
  const progressPercent = resolveSimulationRuntimeProgressPercent(runtimeStatus);

  return (
    <article
      className={cm(styles, "definition-card simulation-recipe-status-runtime-inspector")}
      data-inspector-key={SIMULATION_RECIPE_STATUS_RUNTIME_INSPECTOR_KEY}
      data-channel-id={channelId}
    >
      {recipeId !== null && (
        <RecipeDisplay
          recipeId={recipeId}
          index={index}
          showDevice={false}
          t={t}
        />
      )}
      {progressPercent !== null && (
        <div className={cm(styles, "progress-bar")}>
          <div className={cm(styles, "progress-track")}>
            <div
              className={cm(styles, "progress-fill")}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <span className={cm(styles, "progress-percent")}>
            {Number.isInteger(progressPercent)
              ? String(progressPercent)
              : progressPercent.toFixed(1)}
            %
          </span>
        </div>
      )}
    </article>
  );
}
