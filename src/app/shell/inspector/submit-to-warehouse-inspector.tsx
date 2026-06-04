import React from "react";

import type { AppHost } from "@/app/host/app-host";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { SimulationDeviceRuntimeStatusReadModel } from "@/domain/simulation/types/simulation-types";
import { InspectorCollapsiblePanel } from "@/app/shell/inspector/inspector-collapsible-panel";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

export const SUBMIT_TO_WAREHOUSE_INSPECTOR_KEY = "submit-to-warehouse";

export interface SubmitToWarehouseInspectorProps {
  appHost: AppHost;
  entity: WorldEntity;
  definition: EntityDefinition;
  runtimeStatus: SimulationDeviceRuntimeStatusReadModel | null;
  translate: (key: string) => string;
}

export function SubmitToWarehouseInspector({
  appHost,
  entity,
  definition,
  runtimeStatus,
  translate,
}: SubmitToWarehouseInspectorProps) {
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
    <InspectorCollapsiblePanel
      className="submit-to-warehouse-inspector"
      dataInspectorKey={SUBMIT_TO_WAREHOUSE_INSPECTOR_KEY}
      title={translate("inspector.submitToWarehouse.label")}
    >
      {manualChannels.map((ch) => {
        const recipes = [...registry.recipeDefinitions].filter(
          (r) => r.machineId === definition.id,
        );
        const selectedRecipeId = storedRecipes[ch.id] ?? null;

        if (recipes.length === 1) {
          const recipe = recipes[0]!;
          const isSelected = selectedRecipeId === recipe.id;

          // AI-CORRECTION 2026-05-30: recipeId/progressSeconds/desiredSeconds 已从
          //   SimulationDeviceRuntimeStatusReadModel 删除，改为从 channelRecipes 中
          //   查找正在运行 r_warehouse_submit 的 channel 并读取其进度。
          //   若没有任何 channel 运行该配方，视为进度为 0。
          const submitChannelEntry = runtimeStatus?.channelRecipes
            ? Object.entries(runtimeStatus.channelRecipes).find(
                ([, chStatus]) => chStatus?.recipeId === "r_warehouse_submit",
              )
            : undefined;
          const submitChannelStatus = submitChannelEntry?.[1] ?? null;
          const isRunning = submitChannelStatus !== null;
          const progressSeconds = submitChannelStatus?.progressSeconds ?? 0;
          const desiredSeconds = submitChannelStatus?.desiredSeconds ?? 0;
          const remainingSeconds = isRunning && desiredSeconds > 0
            ? Math.max(0, Math.ceil(desiredSeconds - progressSeconds))
            : null;

          return (
            <React.Fragment key={ch.id}>
              <label
                className={cm(styles, "submit-to-warehouse-row")}
                data-channel-id={ch.id}
              >
                <span className={cm(styles, "submit-to-warehouse-label")}>
                  {translate("inspector.submitToWarehouse.label")}
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={isSelected}
                  className={cm(styles, "submit-to-warehouse-switch")}
                  data-recipe-select={ch.id}
                  onChange={() => handleRecipeSelect(ch.id, isSelected ? null : recipe.id)}
                />
              </label>
              {isSelected && remainingSeconds !== null && (
                <div
                  className={cm(styles, "submit-to-warehouse-countdown")}
                  data-countdown={ch.id}
                >
                  {translate("inspector.submitToWarehouse.countdown")}
                  {" "}
                  {remainingSeconds}s
                </div>
              )}
            </React.Fragment>
          );
        }

        return (
          <div key={ch.id} className={cm(styles, "submit-to-warehouse-row")} data-channel-id={ch.id}>
            <select
              value={selectedRecipeId ?? ""}
              onChange={(e) => handleRecipeSelect(ch.id, e.target.value || null)}
              className={cm(styles, "submit-to-warehouse-select")}
            >
              <option value="">—</option>
              {recipes.map((r) => (
                <option key={r.id} value={r.id}>{r.nameKey}</option>
              ))}
            </select>
          </div>
        );
      })}
    </InspectorCollapsiblePanel>
  );
}
