import React from "react";

import type { AppHost } from "@/app/host/app-host";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { SimulationDeviceRuntimeStatusReadModel } from "@/domain/simulation/types/simulation-types";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

export const RECIPE_CONFIG_INSPECTOR_KEY = "recipe-config";

export interface RecipeConfigInspectorProps {
  appHost: AppHost;
  entity: WorldEntity;
  definition: EntityDefinition;
  runtimeStatus: SimulationDeviceRuntimeStatusReadModel | null;
  translate: (key: string) => string;
}

export function RecipeConfigInspector({
  appHost,
  entity,
  definition,
  runtimeStatus,
  translate,
}: RecipeConfigInspectorProps) {
  const registry = appHost.workspace.registry;
  const storedRecipes = (entity.config?.channelRecipes as Record<string, string> | undefined) ?? {};

  const manualChannels = definition.recipeChannels.filter((ch) => ch.manualRecipeOnly);

  if (manualChannels.length === 0) {
    return null;
  }

  const handleRecipeSelect = (chId: string, recipeId: string | null) => {
    const editor = appHost.workspace.editor;
    if (editor === null) return;

    const next: Record<string, string | null> = { ...storedRecipes };
    if (recipeId === null) {
      delete next[chId];
    } else {
      next[chId] = recipeId;
    }
    editor.actions.patchEntityConfig(entity.id, { channelRecipes: next });
  };

  return (
    <article
      className={cm(styles, "definition-card")}
      data-inspector-key={RECIPE_CONFIG_INSPECTOR_KEY}
    >
      {manualChannels.map((ch) => {
        const recipes = [...registry.recipeDefinitions].filter(
          (r) => r.machineId === definition.id,
        );
        const selectedRecipeId = storedRecipes[ch.id] ?? null;

        if (recipes.length === 1) {
          const recipe = recipes[0]!;
          const isSelected = selectedRecipeId === recipe.id;
          const progressSeconds = runtimeStatus?.progressSeconds ?? null;
          const desiredSeconds = runtimeStatus?.desiredSeconds ?? null;
          const isRunning = runtimeStatus?.recipeId === recipe.id;
          const remainingSeconds = isRunning && progressSeconds !== null && desiredSeconds !== null
            ? Math.max(0, Math.ceil(desiredSeconds - progressSeconds))
            : null;

          return (
            <React.Fragment key={ch.id}>
              <label
                className={cm(styles, "recipe-config-row")}
                data-channel-id={ch.id}
              >
                <span className={cm(styles, "recipe-config-label")}>
                  {translate("inspector.recipeConfig.submitToWarehouse")}
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={isSelected}
                  className={cm(styles, "recipe-config-switch")}
                  data-recipe-select={ch.id}
                  onChange={() => handleRecipeSelect(ch.id, isSelected ? null : recipe.id)}
                />
              </label>
              {isSelected && remainingSeconds !== null && (
                <div
                  className={cm(styles, "recipe-config-countdown")}
                  data-countdown={ch.id}
                >
                  {translate("inspector.recipeConfig.countdown")}
                  {" "}
                  {remainingSeconds}s
                </div>
              )}
            </React.Fragment>
          );
        }

        return (
          <div key={ch.id} className={cm(styles, "recipe-config-row")} data-channel-id={ch.id}>
            <select
              value={selectedRecipeId ?? ""}
              onChange={(e) => handleRecipeSelect(ch.id, e.target.value || null)}
              className={cm(styles, "recipe-config-select")}
            >
              <option value="">—</option>
              {recipes.map((r) => (
                <option key={r.id} value={r.id}>{r.nameKey}</option>
              ))}
            </select>
          </div>
        );
      })}
    </article>
  );
}
