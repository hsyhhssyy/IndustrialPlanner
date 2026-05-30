import type {
  SimulationDeviceRuntimeChannelRecipeStatus,
  SimulationDeviceRuntimeStatusReadModel,
} from "@/domain/simulation/types/simulation-types";
import type { ProductionPlanningIndex } from "@/app/shell/production-planning/production-planning-model";
import type { AppHost } from "@/app/host/app-host";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition, RecipeChannelDefinition } from "@/domain/registry/types/entity-definition";
import { RecipeDisplay } from "@/app/shell/shared/recipe-display";
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
  if (channelIds.length === 0) return null;

  // 分离 auto 与 manual channel
  const autoChannels = channels.filter(
    (ch) => channelIds.includes(ch.id) && !ch.manualRecipeOnly,
  );
  const manualChannels = channels.filter(
    (ch) => channelIds.includes(ch.id) && ch.manualRecipeOnly,
  );

  const hasAuto = autoChannels.length > 0;
  const hasManual = manualChannels.length > 0;

  // 实体配置中已选配方
  const storedRecipes = (entity?.config?.channelRecipes as Record<string, string> | undefined) ?? {};

  // 运行时 channel 配方状态
  const channelRecipeStatus = runtimeStatus?.channelRecipes ?? {};

  return (
    <article
      className={cm(styles, "definition-card simulation-recipe-status-runtime-inspector")}
      data-inspector-key={SIMULATION_RECIPE_STATUS_RUNTIME_INSPECTOR_KEY}
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
        />
      )}
    </article>
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
            <div key={running.ch.id} className={cm(styles, "recipe-channel-row")}>
              <RecipeDisplay
                recipeId={running.status.recipeId!}
                index={index}
                showDevice={false}
                t={t}
              />
              {pct !== null && <ProgressBar percent={pct} />}
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
          <div key={ch.id} className={cm(styles, "recipe-channel-row")}>
            <RecipeDisplay
              recipeId={recipeId!}
              index={index}
              showDevice={false}
              t={t}
            />
            {pct !== null && <ProgressBar percent={pct} />}
            <button
              className={cm(styles, "recipe-remove-button")}
              onClick={() => handleRemoveRecipe(ch.id)}
              type="button"
              title={t("productionPlanning.remove")}
            >
              ×
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
            <span className={cm(styles, "recipe-add-icon")}>+</span>
          </button>
        );
      })()}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 进度条
// ---------------------------------------------------------------------------

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className={cm(styles, "progress-bar")}>
      <div className={cm(styles, "progress-track")}>
        <div
          className={cm(styles, "progress-fill")}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className={cm(styles, "progress-percent")}>
        {Number.isInteger(percent) ? String(percent) : percent.toFixed(1)}
        %
      </span>
    </div>
  );
}
