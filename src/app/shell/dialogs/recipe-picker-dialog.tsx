import { useMemo, type CSSProperties } from "react";
import { observer } from "mobx-react-lite";
import LucideClock3 from "~icons/lucide/clock-3";
import LucideSearch from "~icons/lucide/search";

import type { AppHost } from "@/app/host/app-host";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import { isRecipeVisibleInToolbox } from "@/shared/registry/recipe-visibility";
import { DialogShell } from "@/app/shell/shared/dialog-shell";
import {
  buildEncyclopediaIndex,
  resolveEntityIcon,
  resolveItemIcon,
  resolveItemName,
  type EncyclopediaIndex,
} from "@/app/shell/encyclopedia/encyclopedia-browser";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

function shouldUseImmersiveMaximizedDialog(
  screenProfile: AppHost["state"]["screenProfile"],
): boolean {
  return screenProfile.deviceClass === "mobile" || screenProfile.deviceClass === "tablet";
}

function resolveCopy(locale: AppHost["state"]["settings"]["locale"]) {
  return locale === "zh-CN"
    ? {
      title: "选择配方",
      searchPlaceholder: "搜索产物、设备或原料",
      recipeCount: "个配方",
      noRecipes: "没有可选配方",
      noMatches: "没有符合条件的配方",
      inputs: "原料",
      outputs: "产物",
      noInputs: "无原料",
      noOutputs: "无产物",
      duration: "耗时",
      select: "选择配方",
    }
    : {
      title: "Select Recipe",
      searchPlaceholder: "Search products, machines, or ingredients",
      recipeCount: "recipes",
      noRecipes: "No recipes available",
      noMatches: "No matching recipes",
      inputs: "Ingredients",
      outputs: "Products",
      noInputs: "No ingredients",
      noOutputs: "No products",
      duration: "Duration",
      select: "Select recipe",
    };
}

export const RecipePickerDialog = observer(function RecipePickerDialog({
  appHost,
}: {
  appHost: AppHost;
}) {
  const controller = appHost.recipePicker;
  const dialogState = controller.dialogState;
  const t = appHost.actions.translate;
  const locale = appHost.state.settings.locale;
  const copy = useMemo(() => resolveCopy(locale), [locale]);
  const registry = appHost.workspace.registry;
  const screenProfile = appHost.state.screenProfile;
  const isMobileCompactLayout = screenProfile.deviceClass === "mobile";
  const isPhoneLayout = screenProfile.deviceClass === "mobile";
  const isTabletLayout = screenProfile.deviceClass === "tablet";
  const isTouch = shouldUseImmersiveMaximizedDialog(screenProfile);
  const index = useMemo(
    () => buildEncyclopediaIndex(
      registry.itemDefinitions,
      registry.entityDefinitions,
      registry.recipeDefinitions,
    ),
    [registry],
  );
  const scopedRecipes = useMemo(
    () => resolveScopedRecipes(registry.recipeDefinitions, controller.source),
    [controller.source, registry.recipeDefinitions],
  );
  const normalizedQuery = controller.query.trim().toLowerCase();
  const visibleRecipes = useMemo(
    () => scopedRecipes.filter((recipe) => matchesRecipeSearch(recipe, normalizedQuery, index, t)),
    [index, normalizedQuery, scopedRecipes, t],
  );
  const emptyText = scopedRecipes.length === 0 ? copy.noRecipes : copy.noMatches;
  const dialogClassName = isTouch ? "recipe-picker-dialog-touch" : "recipe-picker-dialog";

  if (!dialogState.visible) {
    return null;
  }

  const initialShellStyle: CSSProperties | undefined = dialogState.width === null && dialogState.height === null
    ? {
      width: isPhoneLayout ? "100%" : isTabletLayout ? "min(780px, 100%)" : "min(860px, 100%)",
      height: isPhoneLayout ? "min(560px, 100%)" : isTabletLayout ? "min(640px, 100%)" : "min(640px, 100%)",
      minHeight: isPhoneLayout ? "320px" : "420px",
    }
    : undefined;

  return (
    <DialogShell
      bodyClassName="recipe-picker-dialog-body"
      className={dialogClassName}
      closeTitle={t("action.close")}
      compactMobileLayout={isMobileCompactLayout}
      dialogKey="recipe-picker"
      dialogState={dialogState}
      immersiveMaximized={dialogState.maximized && shouldUseImmersiveMaximizedDialog(screenProfile)}
      maximizeTitle={t("dialog.maximize")}
      onClose={controller.cancel}
      onOffsetChange={controller.setOffset}
      onResize={isPhoneLayout ? undefined : controller.setSize}
      onToggleMaximized={controller.toggleMaximized}
      restoreTitle={t("dialog.restore")}
      shellStyle={initialShellStyle}
      showMaximizeButton={!isPhoneLayout}
      title={controller.title ?? copy.title}
      titleId="recipe-picker-dialog-title"
    >
      <div className={cm(styles, "recipe-picker-dialog-content")}>
        <label className={cm(styles, "recipe-picker-search")}>
          <LucideSearch aria-hidden="true" />
          <input
            autoFocus
            value={controller.query}
            onChange={(event) => controller.setQuery(event.currentTarget.value)}
            placeholder={copy.searchPlaceholder}
            type="search"
          />
        </label>
        <div className={cm(styles, "recipe-picker-toolbar")}>
          <span>{visibleRecipes.length} {copy.recipeCount}</span>
        </div>
        <div className={cm(styles, "recipe-picker-list")}>
          {visibleRecipes.length > 0 ? (
            visibleRecipes.map((recipe) => (
              <RecipePickerCard
                copy={copy}
                index={index}
                key={recipe.id}
                recipe={recipe}
                t={t}
                onSelect={controller.selectRecipe}
              />
            ))
          ) : (
            <div className={cm(styles, "recipe-picker-empty")}>{emptyText}</div>
          )}
        </div>
      </div>
    </DialogShell>
  );
});

function RecipePickerCard({
  recipe,
  index,
  copy,
  onSelect,
  t,
}: {
  recipe: RecipeDefinition;
  index: EncyclopediaIndex;
  copy: ReturnType<typeof resolveCopy>;
  onSelect: (recipeId: string) => void;
  t: (key: string) => string;
}) {
  const machineName = resolveMachineName(recipe.machineId, index, t);
  const outputNames = recipe.outputs
    .map((output) => resolveItemName(output.itemId, index, t))
    .join("、");
  const ariaLabel = outputNames.length > 0
    ? `${copy.select}: ${machineName}, ${outputNames}`
    : `${copy.select}: ${machineName}, ${recipe.id}`;

  return (
    <article className={cm(styles, "recipe-picker-card")}>
      <button
        aria-label={ariaLabel}
        className={cm(styles, "recipe-picker-card-button")}
        data-recipe-id={recipe.id}
        onClick={() => onSelect(recipe.id)}
        type="button"
      >
        <div className={cm(styles, "recipe-picker-card-header")}>
          <span className={cm(styles, "recipe-picker-machine")}>
            <img alt="" src={resolveEntityIcon(recipe.machineId)} />
            <span>{machineName}</span>
          </span>
          <span className={cm(styles, "recipe-picker-duration")} title={copy.duration}>
            <LucideClock3 aria-hidden="true" />
            <span>{formatRecipeDuration(recipe.durationSeconds)}</span>
          </span>
        </div>
        <div className={cm(styles, "recipe-picker-formula")}>
          <RecipePickerItemList
            emptyText={copy.noInputs}
            index={index}
            items={recipe.inputs}
            label={copy.inputs}
            t={t}
          />
          <span className={cm(styles, "recipe-picker-formula-arrow")} aria-hidden="true">-&gt;</span>
          <RecipePickerItemList
            emptyText={copy.noOutputs}
            index={index}
            items={recipe.outputs}
            label={copy.outputs}
            t={t}
          />
        </div>
      </button>
    </article>
  );
}

function RecipePickerItemList({
  label,
  emptyText,
  items,
  index,
  t,
}: {
  label: string;
  emptyText: string;
  items: RecipeDefinition["inputs"];
  index: EncyclopediaIndex;
  t: (key: string) => string;
}) {
  return (
    <div className={cm(styles, "recipe-picker-item-list")}>
      <span className={cm(styles, "recipe-picker-item-list-title")}>{label}</span>
      {items.length > 0 ? (
        <div className={cm(styles, "recipe-picker-item-chip-list")}>
          {items.map((item) => (
            <span className={cm(styles, "recipe-picker-item-chip")} key={item.itemId}>
              <img alt="" src={resolveItemIcon(item.itemId, index)} />
              <span>{resolveItemName(item.itemId, index, t)}</span>
            </span>
          ))}
        </div>
      ) : (
        <span className={cm(styles, "recipe-picker-item-empty")}>{emptyText}</span>
      )}
    </div>
  );
}

function resolveScopedRecipes(
  registryRecipes: readonly RecipeDefinition[],
  source: AppHost["recipePicker"]["source"],
): RecipeDefinition[] {
  const visibleRegistryRecipes = registryRecipes.filter(isRecipeVisibleInToolbox);

  if (source === null) {
    return visibleRegistryRecipes;
  }

  if (source.kind === "recipes") {
    return source.recipes.filter(isRecipeVisibleInToolbox);
  }

  const entityIds = new Set(source.entityIds);

  if (entityIds.size === 0) {
    return [];
  }

  return visibleRegistryRecipes.filter((recipe) => entityIds.has(recipe.machineId));
}

function matchesRecipeSearch(
  recipe: RecipeDefinition,
  normalizedQuery: string,
  index: EncyclopediaIndex,
  t: (key: string) => string,
): boolean {
  if (normalizedQuery.length === 0) {
    return true;
  }

  if (resolveMachineName(recipe.machineId, index, t).toLowerCase().includes(normalizedQuery)) {
    return true;
  }

  return [...recipe.outputs, ...recipe.inputs].some((item) => (
    resolveItemName(item.itemId, index, t).toLowerCase().includes(normalizedQuery)
  ));
}

function resolveMachineName(
  machineId: string,
  index: Pick<EncyclopediaIndex, "entityById">,
  t: (key: string) => string,
): string {
  const machine = index.entityById.get(machineId);

  return machine === undefined ? machineId : t(machine.nameKey);
}

function formatRecipeDuration(durationSeconds: number): string {
  if (!Number.isFinite(durationSeconds)) {
    return "-";
  }

  return `${Number.isInteger(durationSeconds) ? durationSeconds : durationSeconds.toFixed(1)}s`;
}
