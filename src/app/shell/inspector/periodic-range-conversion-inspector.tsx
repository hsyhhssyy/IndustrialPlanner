import type { AppHost } from "@/app/host/app-host";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition, RecipeChannelDefinition } from "@/domain/registry/types/entity-definition";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import { CONSUMPTION_RECIPE_TAG } from "@/shared/consumption-channel";
import { isRecipeAvailableInChannel } from "@/shared/registry/recipe-channel-eligibility";
import { cm } from "@/app/shell/shared/css-module-class";
import styles from "./inspector.module.scss";

export type PeriodicRangeConversionRecipeIds = readonly [string, string];

export function resolvePeriodicRangeConversionRecipeIds(
  definition: EntityDefinition,
  channel: RecipeChannelDefinition,
  recipes: readonly RecipeDefinition[],
): PeriodicRangeConversionRecipeIds | null {
  if (!channel.projectionRangeIds) return null;
  const candidates = recipes.filter(recipe => (recipe.ownerDeviceId ?? recipe.machineId) === definition.id
    && recipe.tags.includes(CONSUMPTION_RECIPE_TAG) === (channel.type === "consumption-channel")
    && isRecipeAvailableInChannel(recipe, channel.id, definition.recipeChannels));
  const ming = candidates.find(recipe => recipe.periodicRangeConversion?.side === 0);
  const hui = candidates.find(recipe => recipe.periodicRangeConversion?.side === 1);
  if (!ming || !hui || ming.periodicRangeConversion!.programId !== hui.periodicRangeConversion!.programId) return null;
  return [ming.id, hui.id];
}

export function PeriodicRangeConversionInspector({
  appHost,
  entity,
  channelId,
  recipeIds,
  selectedRecipeId,
  t,
}: {
  appHost: AppHost;
  entity: WorldEntity;
  channelId: string;
  recipeIds: PeriodicRangeConversionRecipeIds;
  selectedRecipeId: string | undefined;
  t: (key: string) => string;
}) {
  const editor = appHost.workspace.editor;
  const label = channelId === "east" || channelId === "south"
    ? t("inspector.periodicRangeConversion." + channelId) : t("inspector.periodicRangeConversion.label");
  const labels = [t("inspector.periodicRangeConversion.ming"), t("inspector.periodicRangeConversion.hui")];
  return (
    <div
      aria-label={label}
      className={cm(styles, "periodic-range-conversion")}
      role="group"
    >
      <span>{label}</span>
      {recipeIds.map((recipeId, index) => (
        <button
          aria-pressed={selectedRecipeId === recipeId}
          disabled={editor === null}
          key={recipeId}
          onClick={() => {
            const currentEntity = editor?.queries.getEntityById(entity.id);
            if (!editor || !currentEntity || currentEntity.definitionId !== entity.definitionId) return;
            const currentRecipes = currentEntity.config.channelRecipes as Record<string, string> | undefined;
            if (currentRecipes?.[channelId] === recipeId) return;
            editor.actions.patchEntityConfig(entity.id, {
              channelRecipes: { ...currentRecipes, [channelId]: recipeId },
            });
          }}
          type="button"
        >
          {labels[index]}
        </button>
      ))}
    </div>
  );
}

// AI-REMOVED 2026-11-26:
// Reason: ST3-RQ-002 投影控件和物料成功率由通道与配方声明决定。
// Trigger: 阵列四层必成、双口独立和跨读者单一配方来源的已确认需求。
// Evidence: 此文件的原有声明或消费者引用已迁入下述实现，回归清单见 ST3-RQ-002 执行日志。
// Replacement: periodic-range-conversion-inspector.tsx 与 periodic-range-attachment-inspector.tsx
// Risk: 恢复历史逻辑会同时启用两条业务路径。
// Human Review: Required
//
// Original code:
// import type { PeriodicRangeConversionProgram } from "@/domain/registry/types/periodic-range-conversion";
//
// import { isRecipeVisibleInToolbox } from "@/shared/registry/recipe-visibility";
//
//
// function programsMatch(a: PeriodicRangeConversionProgram, b: PeriodicRangeConversionProgram): boolean {
//   return a === b || (
//     a.id === b.id && a.periodSeconds === b.periodSeconds
//     && a.effects.every((effect, index) => {
//       const other = b.effects[index]!;
//       const outputs = Object.entries(effect.outputItemByInputId);
//       return effect.probabilityByLayer.length === other.probabilityByLayer.length
//         && effect.probabilityByLayer.every((probability, layer) => probability === other.probabilityByLayer[layer])
//         && outputs.length === Object.keys(other.outputItemByInputId).length
//         && outputs.every(([input, output]) => other.outputItemByInputId[input] === output);
//     })
//   );
// }
//
//   const candidates = recipes.filter((recipe) =>
//     (recipe.ownerDeviceId === undefined ? recipe.machineId === definition.id : recipe.ownerDeviceId === definition.id)
//     && isRecipeAvailableInChannel(recipe, channel.id, definition.recipeChannels)
//
//     && (recipe.periodicRangeConversion !== undefined || isRecipeVisibleInToolbox(recipe)),
//   );
//   if (candidates.length !== 2) return null;
//
//   const ming = candidates.find((recipe) => recipe.periodicRangeConversion?.side === 0);
//   const hui = candidates.find((recipe) => recipe.periodicRangeConversion?.side === 1);
//   if (!ming || !hui || ming.id === hui.id) return null;
//
//   const mingSource = ming.periodicRangeConversion!;
//   const huiSource = hui.periodicRangeConversion!;
//   const mingRanges = new Set(mingSource.rangeIds);
//   const huiRanges = new Set(huiSource.rangeIds);
//   if (
//     mingRanges.size === 0 || mingRanges.size !== huiRanges.size
//     || ![...mingRanges].every((id) => huiRanges.has(id) && definition.ranges?.some((range) => range.id === id))
//     || !programsMatch(mingSource.program, huiSource.program)
//   ) return null;
//
//
//       aria-label={t("inspector.periodicRangeConversion.label")}
