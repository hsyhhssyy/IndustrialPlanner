import type {
  SimulationDeviceRuntimeStatusReadModel,
} from "@/domain/simulation/types/simulation-types";
import type { ProductionPlanningIndex } from "@/app/shell/production-planning/production-planning-model";
import type { AppHost } from "@/app/host/app-host";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
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
  /** 若为 true 则显示配方选择按钮而非只读配方展示；默认 false */
  manualRecipeOnly?: boolean;
  appHost?: AppHost;
  entity?: WorldEntity;
  definition?: EntityDefinition;
}

export function SimulationRecipeStatusRuntimeInspector({
  channelId,
  runtimeStatus,
  index,
  t,
  manualRecipeOnly = false,
  appHost,
  entity,
  definition,
}: SimulationRecipeStatusRuntimeInspectorProps) {
  const recipeId = runtimeStatus?.recipeId ?? null;
  const progressPercent = resolveSimulationRuntimeProgressPercent(runtimeStatus);

  const storedRecipes = (entity?.config?.channelRecipes as Record<string, string> | undefined) ?? {};
  const selectedRecipeId = storedRecipes[channelId] ?? null;

  const handleRecipeSelect = async () => {
    if (!appHost || !definition || !entity) return;
    const pickedId = await appHost.recipePicker.pickRecipe({
      entities: [definition],
      title: t("productionPlanning.chooseRecipe"),
    });
    if (pickedId !== null) {
      const editor = appHost.workspace.editor;
      if (!editor) return;
      const next = { ...storedRecipes };
      next[channelId] = pickedId;
      editor.actions.patchEntityConfig(entity.id, { channelRecipes: next });
    }
  };

  const showRecipeDisplay = !manualRecipeOnly && recipeId !== null;
  const showPlaceholder = !manualRecipeOnly && recipeId === null;
  const showManualButton = manualRecipeOnly;

  return (
    <article
      className={cm(styles, "definition-card simulation-recipe-status-runtime-inspector")}
      data-inspector-key={SIMULATION_RECIPE_STATUS_RUNTIME_INSPECTOR_KEY}
      data-channel-id={channelId}
    >
      {showRecipeDisplay && (
        <RecipeDisplay
          recipeId={recipeId}
          index={index}
          showDevice={false}
          t={t}
        />
      )}
      {showPlaceholder && (
        <div className={cm(styles, "recipe-status-placeholder")} />
      )}
      {showManualButton && (
        <button
          className={cm(styles, "recipe-select-button")}
          data-channel-id={channelId}
          onClick={handleRecipeSelect}
          type="button"
        >
          {selectedRecipeId !== null ? (
            <RecipeDisplay
              recipeId={selectedRecipeId}
              index={index}
              showDevice={false}
              t={t}
            />
          ) : (
            <span className={cm(styles, "recipe-select-placeholder")}>
              {t("productionPlanning.chooseRecipe")}
            </span>
          )}
        </button>
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
