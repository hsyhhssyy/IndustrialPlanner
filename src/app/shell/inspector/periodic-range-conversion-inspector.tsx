import type { AppHost } from "@/app/host/app-host";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition, RecipeChannelDefinition } from "@/domain/registry/types/entity-definition";
import type { PeriodicRangeConversionProgram } from "@/domain/registry/types/periodic-range-conversion";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import { CONSUMPTION_RECIPE_TAG } from "@/shared/consumption-channel";
import { isRecipeAvailableInChannel } from "@/shared/registry/recipe-channel-eligibility";
import { isRecipeVisibleInToolbox } from "@/shared/registry/recipe-visibility";
import { cm } from "@/app/shell/shared/css-module-class";
import styles from "./inspector.module.scss";

export type PeriodicRangeConversionRecipeIds = readonly [string, string];

function programsMatch(a: PeriodicRangeConversionProgram, b: PeriodicRangeConversionProgram): boolean {
  return a === b || (
    a.id === b.id && a.periodSeconds === b.periodSeconds
    && a.effects.every((effect, index) => {
      const other = b.effects[index]!;
      const outputs = Object.entries(effect.outputItemByInputId);
      return effect.probabilityByLayer.length === other.probabilityByLayer.length
        && effect.probabilityByLayer.every((probability, layer) => probability === other.probabilityByLayer[layer])
        && outputs.length === Object.keys(other.outputItemByInputId).length
        && outputs.every(([input, output]) => other.outputItemByInputId[input] === output);
    })
  );
}

export function resolvePeriodicRangeConversionRecipeIds(
  definition: EntityDefinition,
  channel: RecipeChannelDefinition,
  recipes: readonly RecipeDefinition[],
): PeriodicRangeConversionRecipeIds | null {
  const candidates = recipes.filter((recipe) =>
    (recipe.ownerDeviceId === undefined ? recipe.machineId === definition.id : recipe.ownerDeviceId === definition.id)
    && isRecipeAvailableInChannel(recipe, channel.id, definition.recipeChannels)
    && recipe.tags.includes(CONSUMPTION_RECIPE_TAG) === (channel.type === "consumption-channel")
    && (recipe.periodicRangeConversion !== undefined || isRecipeVisibleInToolbox(recipe)),
  );
  if (candidates.length !== 2) return null;

  const ming = candidates.find((recipe) => recipe.periodicRangeConversion?.side === 0);
  const hui = candidates.find((recipe) => recipe.periodicRangeConversion?.side === 1);
  if (!ming || !hui || ming.id === hui.id) return null;

  const mingSource = ming.periodicRangeConversion!;
  const huiSource = hui.periodicRangeConversion!;
  const mingRanges = new Set(mingSource.rangeIds);
  const huiRanges = new Set(huiSource.rangeIds);
  if (
    mingRanges.size === 0 || mingRanges.size !== huiRanges.size
    || ![...mingRanges].every((id) => huiRanges.has(id) && definition.ranges?.some((range) => range.id === id))
    || !programsMatch(mingSource.program, huiSource.program)
  ) return null;

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
  const labels = [t("inspector.periodicRangeConversion.ming"), t("inspector.periodicRangeConversion.hui")];
  return (
    <div
      aria-label={t("inspector.periodicRangeConversion.label")}
      className={cm(styles, "periodic-range-conversion")}
      role="group"
    >
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
