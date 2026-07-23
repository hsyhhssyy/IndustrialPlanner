import type {
  SimulationDeviceRuntimeChannelRecipeStatus,
  SimulationDeviceRuntimeStatusReadModel,
} from "@/domain/simulation/types/simulation-types";
import LucideLock from "~icons/lucide/lock";
import LucidePlus from "~icons/lucide/plus";
import LucideTrash2 from "~icons/lucide/trash-2";
import type { ProductionPlanningIndex } from "@/app/shell/production-planning/production-planning-model";
import type { AppHost } from "@/app/host/app-host";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition, RecipeChannelDefinition } from "@/domain/registry/types/entity-definition";
import { InspectorCollapsiblePanel } from "@/app/shell/inspector/inspector-collapsible-panel";
import { RecipeDisplay } from "@/app/shell/shared/recipe-display";
import { isAutomaticRecipeChannelMode } from "@/shared/recipe-channel-behavior";
import styles from "@/app/shell/inspector/inspector.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

export const SIMULATION_RECIPE_STATUS_RUNTIME_INSPECTOR_KEY =
  "simulation-recipe-status-runtime-inspector";

// AI-CORRECTION 2026-05-29: 新增 channel 级别的进度计算。
function resolveChannelProgressPercent(
  channelStatus: SimulationDeviceRuntimeChannelRecipeStatus | null,
): number | null {
  if (channelStatus === null) return null;
  const { desiredSeconds, progressSeconds } = channelStatus;
  if (progressSeconds === null || desiredSeconds === null || desiredSeconds <= 0) return null;
  const pct = progressSeconds / desiredSeconds * 100;
  if (!Number.isFinite(pct)) return null;
  return Math.max(0, Math.min(100, pct));
}

// AI-REMOVED 2026-05-30:
// Reason: SimulationDeviceRuntimeStatusReadModel 的 recipeId/progressSeconds/desiredSeconds 字段已删除，
//   该函数的输入类型不再拥有所需字段，且无外部调用方。
// Trigger: 接口字段迁移到 channelRecipes。
// Evidence: grep_search 确认无外部 import 该函数。
// Replacement: resolveChannelProgressPercent（已存在，使用 channelRecipes）
// Risk: Low
// Human Review: Not Required
//
// Original code:
// // AI-CORRECTION 2026-05-29: 保留旧函数兼容现有调用方。
// export function resolveSimulationRuntimeProgressPercent(
//   runtimeStatus: SimulationDeviceRuntimeStatusReadModel | null,
// ): number | null {
//   if (runtimeStatus === null) return null;
//   const { desiredSeconds, progressSeconds } = runtimeStatus;
//   if (progressSeconds === null || desiredSeconds === null || desiredSeconds <= 0) return null;
//   const progressPercent = progressSeconds / desiredSeconds * 100;
//   if (!Number.isFinite(progressPercent)) return null;
//   return Math.max(0, Math.min(100, progressPercent));
// }

export interface SimulationRecipeStatusRuntimeInspectorProps {
  /** 所有 recipe channel ID 列表 */
  channelIds: readonly string[];
  /** 设备声明的全部 recipe channel 定义 */
  channels: readonly RecipeChannelDefinition[];
  runtimeStatus: SimulationDeviceRuntimeStatusReadModel | null;
  index: ProductionPlanningIndex;
  t: (key: string) => string;
  appHost?: AppHost;
  entity?: WorldEntity;
  definition?: EntityDefinition;
}

// AI-CORRECTION 2026-05-29: 重写组件，按 auto/manual 分区展示多 channel 配方状态。
export function SimulationRecipeStatusRuntimeInspector({
  channelIds,
  channels,
  runtimeStatus,
  index,
  t,
  appHost,
  entity,
  definition,
}: SimulationRecipeStatusRuntimeInspectorProps) {
  // 气体环境 tag（必须在所有 early return 之前调用，遵循 hooks 规则）
  const gasEnvTag = (() => {
    if (!appHost || !entity || !definition) return null;

    // 先判断该设备是否有任意配方需要气体环境
    let needsGasEnv = false;
    for (const recipe of index.recipeById.values()) {
      if (recipe.machineId === definition.id && recipe.requiredGasDiffusion) {
        needsGasEnv = true;
        break;
      }
    }
    if (!needsGasEnv) return null;

    // 通过 SimulationQuery 获取设备当前完全处于的气体
    const gasItemIds = appHost.workspace.simulation?.queries.getDeviceActiveGasItemIds(entity.id) ?? null;
    const isInGas = gasItemIds !== null && gasItemIds.length > 0;
    const gasNames = gasItemIds?.map((itemId) => {
      const gasItem = index.itemById.get(itemId);
      return gasItem ? t(gasItem.nameKey) : itemId;
    }) ?? [];

    return (
      <span
        className={cm(
          styles,
          "recipe-gas-env-tag",
          isInGas ? "recipe-gas-env-tag--in-gas" : "recipe-gas-env-tag--no-gas",
        )}
      >
        {isInGas
          ? `当前所处气体环境: ${gasNames.join(", ")}`
          : "未处于气体环境"}
      </span>
    );
  })();

  if (channelIds.length === 0) return null;

  const recipeChannelBehavior = definition?.recipeChannelBehavior;
  const modeConfigKey = recipeChannelBehavior?.automaticModeConfigKey;
  const modeSwitchable = modeConfigKey !== undefined;
  const automaticMode = isAutomaticRecipeChannelMode(
    recipeChannelBehavior,
    entity?.config ?? {},
  );

  // 分离 auto 与 manual channel
  const autoChannels = channels.filter(
    (ch) => channelIds.includes(ch.id) && (modeSwitchable ? automaticMode : !ch.manualRecipeOnly),
  );
  const manualChannels = channels.filter(
    (ch) => channelIds.includes(ch.id) && (modeSwitchable ? !automaticMode : ch.manualRecipeOnly),
  );

  const hasAuto = autoChannels.length > 0;
  const hasManual = manualChannels.length > 0;

  // 实体配置中已选配方
  const storedRecipes = (entity?.config?.channelRecipes as Record<string, string> | undefined) ?? {};

  // 运行时 channel 配方状态
  const channelRecipeStatus = runtimeStatus?.channelRecipes ?? {};

  if (runtimeStatus === null && !hasManual && !modeSwitchable) {
    return null;
  }

  const modeSwitch = modeConfigKey === undefined || entity === undefined
    ? null
    : (
        <label
          className={cm(styles, "recipe-channel-mode-switch")}
          title={t("inspector.recipeChannelMode.label")}
        >
          <input
            aria-label={t("inspector.recipeChannelMode.label")}
            checked={automaticMode}
            data-recipe-channel-mode-switch
            onChange={(event) => {
              appHost?.workspace.editor?.actions.patchEntityConfig(entity.id, {
                [modeConfigKey]: event.currentTarget.checked,
              });
            }}
            role="switch"
            type="checkbox"
          />
          <span>
            {t(automaticMode
              ? "inspector.recipeChannelMode.automatic"
              : "inspector.recipeChannelMode.manual")}
          </span>
        </label>
      );

  return (
    <InspectorCollapsiblePanel
      className={cm(styles, "simulation-recipe-status-runtime-inspector")}
      dataInspectorKey={SIMULATION_RECIPE_STATUS_RUNTIME_INSPECTOR_KEY}
      title="配方状态"
      titleClassName={cm(styles, "recipe-status-panel-title")}
      headerActions={gasEnvTag === null && modeSwitch === null ? undefined : (
        <>
          {gasEnvTag}
          {modeSwitch}
        </>
      )}
    >
      {hasAuto && (
        <AutoRecipeSection
          autoChannels={autoChannels}
          channelRecipeStatus={channelRecipeStatus}
          index={index}
          t={t}
        />
      )}
      {hasAuto && hasManual && (
        <div className={cm(styles, "recipe-section-divider")} />
      )}
      {hasManual && (
        <ManualRecipeSection
          manualChannels={manualChannels}
          storedRecipes={storedRecipes}
          channelRecipeStatus={channelRecipeStatus}
          index={index}
          t={t}
          appHost={appHost}
          entity={entity}
          definition={definition}
          allowDuplicateRecipesAcrossChannels={
            recipeChannelBehavior?.allowDuplicateRecipesAcrossChannels ?? false
          }
        />
      )}
    </InspectorCollapsiblePanel>
  );
}

// ---------------------------------------------------------------------------
// 自动配方区域
// ---------------------------------------------------------------------------

interface AutoRecipeSectionProps {
  autoChannels: readonly RecipeChannelDefinition[];
  channelRecipeStatus: Record<string, SimulationDeviceRuntimeChannelRecipeStatus | null>;
  index: ProductionPlanningIndex;
  t: (key: string) => string;
}

function AutoRecipeSection({
  autoChannels,
  channelRecipeStatus,
  index,
  t,
}: AutoRecipeSectionProps) {
  // 收集运行时正在运行的自动 channel
  const runningChannels: { ch: RecipeChannelDefinition; status: SimulationDeviceRuntimeChannelRecipeStatus }[] = [];
  for (const ch of autoChannels) {
    const status = channelRecipeStatus[ch.id] ?? null;
    if (status !== null && status.recipeId !== null) {
      runningChannels.push({ ch, status });
    }
  }

  // 始终至少显示 1 行（占位或运行中）
  const displayCount = Math.max(1, runningChannels.length);

  return (
    <div className={cm(styles, "recipe-auto-section")}>
      {Array.from({ length: displayCount }).map((_, i) => {
        const running = runningChannels[i] ?? null;
        if (running !== null) {
          const pct = resolveChannelProgressPercent(running.status);
          return (
            <div key={running.ch.id} className={cm(styles, "recipe-channel-row")} data-recipe-row-mode="locked">
              <RecipeDisplay
                recipeId={running.status.recipeId!}
                index={index}
                showDevice={false}
                variant="inspectorStatus"
                progressPercent={pct}
                progressKind="ring"
                t={t}
              />
              <span
                className={cm(styles, "recipe-locked-control")}
                title={t("productionPlanning.autoRecipeReadonly")}
                aria-label={t("productionPlanning.autoRecipeReadonly")}
              >
                <LucideLock aria-hidden="true" />
              </span>
            </div>
          );
        }
        return (
          <div key={`auto-placeholder-${i}`} className={cm(styles, "recipe-channel-row")}>
            <div className={cm(styles, "recipe-status-placeholder")} />
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 手动配方区域
// ---------------------------------------------------------------------------

interface ManualRecipeSectionProps {
  manualChannels: readonly RecipeChannelDefinition[];
  storedRecipes: Record<string, string>;
  channelRecipeStatus: Record<string, SimulationDeviceRuntimeChannelRecipeStatus | null>;
  index: ProductionPlanningIndex;
  t: (key: string) => string;
  appHost?: AppHost;
  entity?: WorldEntity;
  definition?: EntityDefinition;
  allowDuplicateRecipesAcrossChannels: boolean;
}

function ManualRecipeSection({
  manualChannels,
  storedRecipes,
  channelRecipeStatus,
  index,
  t,
  appHost,
  entity,
  definition,
  allowDuplicateRecipesAcrossChannels,
}: ManualRecipeSectionProps) {
  // 已填充的手动 channel（在 entity config 中有配方记录）
  const filledChannels = manualChannels.filter(
    (ch) => storedRecipes[ch.id] !== undefined && storedRecipes[ch.id] !== null,
  );
  const unfilledChannels = manualChannels.filter(
    (ch) => storedRecipes[ch.id] === undefined || storedRecipes[ch.id] === null,
  );

  const handleAddRecipe = async (channelId: string) => {
    if (!appHost || !definition || !entity) return;
    const pickedId = await appHost.recipePicker.pickRecipe({
      entities: [definition],
      title: t("productionPlanning.chooseRecipe"),
    });
    if (pickedId !== null) {
      const editor = appHost.workspace.editor;
      if (!editor) return;
      const next = { ...storedRecipes };
      if (!allowDuplicateRecipesAcrossChannels) {
        for (const [storedChannelId, storedRecipeId] of Object.entries(next)) {
          if (storedChannelId !== channelId && storedRecipeId === pickedId) {
            delete next[storedChannelId];
          }
        }
      }
      next[channelId] = pickedId;
      editor.actions.patchEntityConfig(entity.id, { channelRecipes: next });
    }
  };

  const handleRemoveRecipe = (channelId: string) => {
    if (!appHost || !entity) return;
    const editor = appHost.workspace.editor;
    if (!editor) return;
    const next = { ...storedRecipes };
    delete next[channelId];
    editor.actions.patchEntityConfig(entity.id, { channelRecipes: next });
  };

  return (
    <div className={cm(styles, "recipe-manual-section")}>
      {filledChannels.map((ch) => {
        const recipeId = storedRecipes[ch.id];
        const status = channelRecipeStatus[ch.id] ?? null;
        const pct = resolveChannelProgressPercent(status);
        return (
          <div key={ch.id} className={cm(styles, "recipe-channel-row")} data-recipe-row-mode="removable">
            <RecipeDisplay
              recipeId={recipeId!}
              index={index}
              showDevice={false}
              variant="inspectorStatus"
              progressPercent={pct}
              progressKind="ring"
              t={t}
            />
            <button
              className={cm(styles, "recipe-remove-button")}
              onClick={() => handleRemoveRecipe(ch.id)}
              type="button"
              title={t("productionPlanning.remove")}
              aria-label={t("productionPlanning.remove")}
            >
              <LucideTrash2 aria-hidden="true" />
            </button>
          </div>
        );
      })}
      {unfilledChannels.length > 0 && (() => {
        const nextChannel = unfilledChannels[0]!;
        return (
          <button
            key={`add-${nextChannel.id}`}
            className={cm(styles, "recipe-add-button")}
            onClick={() => handleAddRecipe(nextChannel.id)}
            type="button"
          >
            <span className={cm(styles, "recipe-add-button-primary")}>
              <LucidePlus className={cm(styles, "recipe-add-icon")} aria-hidden="true" />
              <span>{t("productionPlanning.addRecipe")}</span>
            </span>
            {/* AI-REMOVED 2026-06-01:
                Reason: 添加配方按钮按用户要求去掉说明文案，并让入口高度接近配方行。
                Trigger: 用户要求“把添加配方按钮下面的说明去掉，让添加按钮的行高和配方行一致或稍矮”。
                Evidence: 设计稿收敛为低矮操作入口；说明文本会增加真实 tablet inspector 高度。
                Replacement: recipe-add-button-primary 单行按钮内容
                Risk: Low
                Human Review: Required

                Original code:
                <span className={cm(styles, "recipe-add-button-hint")}>
                  {t("productionPlanning.recipeStatusEmptyHint")}
                </span>
            */}
          </button>
        );
      })()}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 进度条
// ---------------------------------------------------------------------------
// AI-REMOVED 2026-06-01:
// Reason: 配方状态面板按 inspector-panel3 设计稿改为内嵌在 RecipeDisplay 中的环形/横向进度视觉，
//   不再使用独立百分比文字进度条。
// Trigger: 用户要求 1:1 更新 recipeStatus 配方展示 UI。
// Evidence: SimulationRecipeStatusRuntimeInspector 已将 progressPercent / progressKind 传入 RecipeDisplay。
// Replacement: RecipeDisplay variant="inspectorStatus"
// Risk: Low
// Human Review: Required
//
// Original code:
// function ProgressBar({ percent }: { percent: number }) {
//   return (
//     <div className={cm(styles, "progress-bar")}>
//       <div className={cm(styles, "progress-track")}>
//         <div
//           className={cm(styles, "progress-fill")}
//           style={{ width: `${percent}%` }}
//         />
//       </div>
//       <span className={cm(styles, "progress-percent")}>
//         {Number.isInteger(percent) ? String(percent) : percent.toFixed(1)}
//         %
//       </span>
//     </div>
//   );
// }
