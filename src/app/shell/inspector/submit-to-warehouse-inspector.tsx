import LucideUpload from "~icons/lucide/upload";

import type { AppHost } from "@/app/host/app-host";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { SimulationDeviceRuntimeStatusReadModel } from "@/domain/simulation/types/simulation-types";
import { InspectorCollapsiblePanel } from "@/app/shell/inspector/inspector-collapsible-panel";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

export const SUBMIT_TO_WAREHOUSE_INSPECTOR_KEY = "submit-to-warehouse";
const WAREHOUSE_SUBMIT_CHANNEL_ID = "warehouse_submit";
const WAREHOUSE_SUBMIT_RECIPE_ID = "r_warehouse_submit";

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
  const submitChannel = definition.recipeChannels.find(
    (ch) => ch.id === WAREHOUSE_SUBMIT_CHANNEL_ID && ch.manualRecipeOnly,
  );
  const hasSubmitRecipe = registry.recipeDefinitions.some(
    (recipe) =>
      recipe.id === WAREHOUSE_SUBMIT_RECIPE_ID
      && recipe.machineId === definition.id,
  );

  if (submitChannel === undefined || !hasSubmitRecipe) {
    return null;
  }

  const isSelected = storedRecipes[submitChannel.id] === WAREHOUSE_SUBMIT_RECIPE_ID;
  const remainingSeconds = isSelected ? resolveSubmitRemainingSeconds(runtimeStatus) : null;

  const handleToggle = () => {
    const editor = appHost.workspace.editor;
    if (editor === null) return;

    const next: Record<string, string> = { ...storedRecipes };
    if (isSelected) {
      delete next[submitChannel.id];
    } else {
      next[submitChannel.id] = WAREHOUSE_SUBMIT_RECIPE_ID;
    }
    editor.actions.patchEntityConfig(entity.id, { channelRecipes: next });
  };

  return (
    <InspectorCollapsiblePanel
      className="submit-to-warehouse-inspector"
      dataInspectorKey={SUBMIT_TO_WAREHOUSE_INSPECTOR_KEY}
      bodyClassName="submit-to-warehouse-panel-body"
      title={translate("inspector.submitToWarehouse.label")}
    >
      {/*
        AI-REMOVED 2026-06-05:
        Reason: submitToWarehouse 的真实语义是启停固定隐形配方，不是选择或展示配方；旧实现保留 recipes/select 分支会把内部实现细节暴露给用户。
        Trigger: 用户明确指出“这个 inspector 固定设置特定的一个隐形配方，所以不需要展示配方，他外表看起来就是一个开关”。
        Evidence: 注册表中 item_port_storager_1 只声明 manual channel warehouse_submit，隐形配方 ID 为 r_warehouse_submit。
        Replacement: 下方 submit-to-warehouse-row 单开关 UI，点击后写入/删除 channelRecipes.warehouse_submit = r_warehouse_submit。
        Risk: Low
        Human Review: Required

        Original code:
        {manualChannels.map((ch) => {
          const recipes = [...registry.recipeDefinitions].filter(
            (r) => r.machineId === definition.id,
          );
          const selectedRecipeId = storedRecipes[ch.id] ?? null;

          if (recipes.length === 1) {
            const recipe = recipes[0]!;
            const isSelected = selectedRecipeId === recipe.id;

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
      */}
      <div
        className={cm(styles, "submit-to-warehouse-row")}
        data-channel-id={submitChannel.id}
        data-submit-enabled={isSelected ? "true" : "false"}
      >
        <span className={cm(styles, "submit-to-warehouse-icon")} aria-hidden="true">
          <LucideUpload />
        </span>
        <span className={cm(styles, "submit-to-warehouse-label")}>自动提交</span>
        {remainingSeconds === null ? null : (
          <span
            className={cm(styles, "submit-to-warehouse-countdown")}
            data-countdown={submitChannel.id}
          >
            {remainingSeconds}s
          </span>
        )}
        <button
          aria-checked={isSelected}
          aria-label={translate("inspector.submitToWarehouse.label")}
          className={cm(styles, "submit-to-warehouse-toggle")}
          data-recipe-select={submitChannel.id}
          onClick={handleToggle}
          role="switch"
          title={translate("inspector.submitToWarehouse.label")}
          type="button"
        >
          <span className={cm(styles, "submit-to-warehouse-toggle-knob")} aria-hidden="true" />
        </button>
      </div>
    </InspectorCollapsiblePanel>
  );
}

function resolveSubmitRemainingSeconds(
  runtimeStatus: SimulationDeviceRuntimeStatusReadModel | null,
): number | null {
  // AI-CORRECTION 2026-05-30: recipeId/progressSeconds/desiredSeconds 已从
  //   SimulationDeviceRuntimeStatusReadModel 删除，改为从 channelRecipes 中
  //   查找正在运行 r_warehouse_submit 的 channel 并读取其进度。
  //   若没有任何 channel 运行该配方，视为进度为 0。
  const submitChannelEntry = runtimeStatus?.channelRecipes
    ? Object.entries(runtimeStatus.channelRecipes).find(
        ([, chStatus]) => chStatus?.recipeId === WAREHOUSE_SUBMIT_RECIPE_ID,
      )
    : undefined;
  const submitChannelStatus = submitChannelEntry?.[1] ?? null;
  const isRunning = submitChannelStatus !== null;
  const progressSeconds = submitChannelStatus?.progressSeconds ?? 0;
  const desiredSeconds = submitChannelStatus?.desiredSeconds ?? 0;

  return isRunning && desiredSeconds > 0
    ? Math.max(0, Math.ceil(desiredSeconds - progressSeconds))
    : null;
}
