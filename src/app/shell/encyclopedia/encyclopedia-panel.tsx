import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { runInAction } from "mobx";
import { observer } from "mobx-react-lite";

import type { AppHost } from "@/app/host/app-host";
import type {
  ToolboxWikiNavigationEntry as NavEntry,
} from "@/app/toolbox-types";
import type { AppLocale } from "@/domain/app/types/app-types";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import {
  LIQUID_DISMANTLE_RECIPE_TAG,
  LIQUID_FILLING_RECIPE_TAG,
} from "@/shared/registry/recipe-visibility";
import {
  isItemAvailableByActivity,
  isRecipeAvailableByActivity,
  resolveActivityIdsFromTags,
  resolveEffectiveActivityIds,
} from "@/shared/registry/activity-availability";
import { ActivityIconStrip } from "@/app/shell/shared/activity-icon-strip";
import {
  EncyclopediaBrowser,
  type EncyclopediaIndex,
  buildEncyclopediaIndex,
  resolveEntityDisplayName,
  resolveEntityIcon,
  resolveItemIcon,
  resolveItemName,
} from "@/app/shell/encyclopedia/encyclopedia-browser";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isSameNavigationEntry(left: NavEntry | null, right: NavEntry | null): boolean {
  if (left === null || right === null) {
    return left === right;
  }

  return left.type === right.type && left.id === right.id;
}

// AI-REMOVED 2026-09-17:
// Reason: 装瓶与拆瓶的配方 tag 已提升为共享分类常量，避免百科和配方选择弹窗各自维护字符串。
// Trigger: 用户要求产线规划配方弹窗统一后置装瓶与拆瓶配方。
// Evidence: Search-First 确认百科已有相同分类逻辑，而配方弹窗缺少该分组。
// Replacement: src/shared/registry/recipe-visibility.ts
// Risk: Low
// Human Review: Required
//
// Original code:
// const LIQUID_FILLING_RECIPE_TAG = "bottle_filling";
// const LIQUID_DISMANTLE_RECIPE_TAG = "liquid_bottle_dismantle";

function hasRecipeTag(recipe: RecipeDefinition, tag: string): boolean {
  return recipe.tags.includes(tag);
}

function dedupeRecipes(recipes: readonly RecipeDefinition[]): RecipeDefinition[] {
  const seen = new Set<string>();

  return recipes.filter((recipe) => {
    if (seen.has(recipe.id)) {
      return false;
    }

    seen.add(recipe.id);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Breadcrumb({
  stack,
  index,
  onNavigate,
  isTouch,
  t,
}: {
  stack: NavEntry[];
  index: EncyclopediaIndex;
  onNavigate: (index: number) => void;
  isTouch: boolean;
  t: (key: string) => string;
}) {
  if (stack.length === 0) {
    return <span className={cm(styles, "encyclopedia-breadcrumb-current")}>{t("encyclopedia.home")}</span>;
  }

  const chips = stack.map((entry, i) => {
    const label = entry.type === "item"
      ? resolveItemName(entry.id, index, t)
      : t(index.entityById.get(entry.id)?.nameKey ?? entry.id);
    const isLast = i === stack.length - 1;

    return (
      <span key={`${entry.type}-${entry.id}`} className={cm(styles, "encyclopedia-breadcrumb-segment")}>
        <button
          type="button"
          className={cm(styles, `encyclopedia-breadcrumb-link${isLast ? " is-active" : ""}`)}
          onClick={() => onNavigate(i)}
          disabled={isLast}
        >
          {label}
        </button>
        {!isLast && <span className={cm(styles, "encyclopedia-breadcrumb-sep")}>/</span>}
      </span>
    );
  });

  return (
    <div className={cm(styles, `encyclopedia-breadcrumb${isTouch ? " is-touch" : ""}`)}>
      <button
        type="button"
        className={cm(styles, "encyclopedia-breadcrumb-link is-home")}
        onClick={() => onNavigate(-1)}
      >
        {t("encyclopedia.home")}
      </button>
      <span className={cm(styles, "encyclopedia-breadcrumb-sep")}>/</span>
      {chips}
    </div>
  );
}

interface RecipeCardEntry {
  readonly key: string;
  readonly recipe: RecipeDefinition;
  readonly inputs: readonly { readonly itemId: string; readonly amount: number }[];
  readonly outputs: readonly { readonly itemId: string; readonly amount: number }[];
}

/**
 * 2026-11-25：周期转化配方的一条配方包含多个独立物品映射，展示时必须拆成每个映射一条；
 * 物品页传入 focusItemId，只保留包含当前物品的那一条映射。
 */
function expandRecipeCardEntries(
  recipes: readonly RecipeDefinition[],
  focusItemId?: string,
): RecipeCardEntry[] {
  const seen = new Set<string>();
  return recipes.flatMap((recipe): RecipeCardEntry[] => {
    const conversion = recipe.periodicRangeConversion;
    if (conversion === undefined) {
      return [{ key: recipe.id, recipe, inputs: recipe.inputs, outputs: recipe.outputs }];
    }
    const effect = conversion.program.effects[conversion.side];
    // 2026-11-25：普通明晦炉与分影明晦炉共用同一程序并挂同一区域设备，展示层按
    // 「设备 + 相位 + 层数概率 + 映射」去重，避免同一物品映射重复出卡。
    const signature = JSON.stringify([recipe.machineId, conversion.side, effect.probabilityByLayer]);
    return Object.entries(effect.outputItemByInputId)
      .filter(([inputItemId, outputItemId]) => focusItemId === undefined
        || inputItemId === focusItemId || outputItemId === focusItemId)
      .filter(([inputItemId]) => {
        const dedupeKey = `${signature}:${inputItemId}`;
        if (seen.has(dedupeKey)) return false;
        seen.add(dedupeKey);
        return true;
      })
      .map(([inputItemId, outputItemId]) => ({
        key: `${recipe.id}:${inputItemId}`,
        recipe,
        inputs: [{ itemId: inputItemId, amount: 1 }],
        outputs: [{ itemId: outputItemId, amount: 1 }],
      }));
  });
}

function RecipeGroup({
  title,
  recipes,
  focusItemId,
  index,
  onItemClick,
  isExpanded,
  onToggle,
  onEntityClick,
  showActivityIcons,
  locale,
  t,
}: {
  title: string;
  recipes: RecipeDefinition[];
  focusItemId?: string;
  index: EncyclopediaIndex;
  onItemClick: (id: string) => void;
  onEntityClick: (id: string) => void;
  isExpanded: boolean;
  onToggle: () => void;
  showActivityIcons: boolean;
  locale: AppLocale;
  t: (key: string) => string;
}) {
  const entries = expandRecipeCardEntries(recipes, focusItemId);
  if (entries.length === 0) return null;

  const sorted = [...entries].sort((a, b) => a.recipe.durationSeconds - b.recipe.durationSeconds);

  return (
    <section className={cm(styles, "encyclopedia-recipe-group")}>
      <button
        type="button"
        className={cm(styles, "encyclopedia-recipe-group-header")}
        onClick={onToggle}
      >
        <span className={cm(styles, "encyclopedia-recipe-group-arrow")}>{isExpanded ? "▾" : "▸"}</span>
        <span className={cm(styles, "encyclopedia-recipe-group-title")}>{title}</span>
        <span className={cm(styles, "encyclopedia-recipe-group-count")}>({sorted.length})</span>
      </button>
      {isExpanded && (
        <div className={cm(styles, "encyclopedia-recipe-list")}>
          {sorted.map((entry) => (
            <RecipeCard
              key={entry.key}
              entry={entry}
              index={index}
              onItemClick={onItemClick}
              onEntityClick={onEntityClick}
              showActivityIcons={showActivityIcons}
              locale={locale}
              t={t}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function RecipeCard({
  entry,
  index,
  onItemClick,
  onEntityClick,
  showActivityIcons,
  locale,
  t,
}: {
  entry: RecipeCardEntry;
  index: EncyclopediaIndex;
  onItemClick: (id: string) => void;
  onEntityClick: (id: string) => void;
  showActivityIcons: boolean;
  locale: AppLocale;
  t: (key: string) => string;
}) {
  const { recipe, inputs, outputs } = entry;
  const probability = recipe.probability;
  const weight = probability !== undefined && probability > 1;
  const probabilityText = probability === undefined ? null : new Intl.NumberFormat(locale, {
    style: weight ? "decimal" : "percent",
    notation: probability < 0.000001 || probability >= 1_000_000 ? "scientific" : "standard",
    maximumSignificantDigits: 6,
  }).format(probability);

  // 2026-11-25：周期转化配方没有静态 inputs/outputs，展示数据来自 periodicRangeConversion 对应相位效果。
  const conversion = recipe.periodicRangeConversion;
  const conversionEffect = conversion === undefined
    ? undefined
    : conversion.program.effects[conversion.side];
  const durationSeconds = conversion?.program.periodSeconds ?? recipe.durationSeconds;
  const layerProbabilityText = conversionEffect === undefined
    ? null
    : conversionEffect.probabilityByLayer
      .map(value => new Intl.NumberFormat(locale, { style: "percent", maximumSignificantDigits: 4 }).format(value))
      .join(" / ");

  const maxRows = Math.max(inputs.length, outputs.length);
  const activityIds = showActivityIcons ? resolveActivityIdsFromTags(recipe.tags) : [];
  const requiredGasItemIds = recipe.requiredEnvironmentAnyOf ?? [];
  const consumedItemIds = index.consumptionItemIdsByMachine.get(recipe.machineId) ?? [];
  const consumptionLabel = consumedItemIds.length > 1
    ? t("encyclopedia.recipe.deviceConsumptionAny")
    : t("encyclopedia.recipe.deviceConsumption");

  return (
    <article className={cm(styles, "encyclopedia-recipe-card definition-card")}>
      <div className={cm(styles, "encyclopedia-recipe-table")}>
        {/* Input column */}
        <div className={cm(styles, "encyclopedia-recipe-col is-input")}>
          {Array.from({ length: maxRows }).map((_, i) => {
            const input = inputs[i];
            if (!input) return <div key={`in-empty-${i}`} className={cm(styles, "encyclopedia-recipe-row is-empty")} />;
            return (
              <button
                key={`in-${input.itemId}`}
                type="button"
                className={cm(styles, "encyclopedia-recipe-row")}
                onClick={() => onItemClick(input.itemId)}
              >
                <img alt="" className={cm(styles, "encyclopedia-recipe-item-icon")} src={resolveItemIcon(input.itemId, index)} />
                <span className={cm(styles, "encyclopedia-recipe-item-name")}>{resolveItemName(input.itemId, index, t)}</span>
                <span className={cm(styles, "encyclopedia-recipe-item-amount")}>×{input.amount}</span>
              </button>
            );
          })}
        </div>

        {/* Arrow */}
        <div className={cm(styles, "encyclopedia-recipe-arrow-col")}>
          <span className={cm(styles, "encyclopedia-recipe-arrow")}>→</span>
        </div>

        {/* Output column */}
        <div className={cm(styles, "encyclopedia-recipe-col is-output")}>
          {Array.from({ length: maxRows }).map((_, i) => {
            const output = outputs[i];
            if (!output) return <div key={`out-empty-${i}`} className={cm(styles, "encyclopedia-recipe-row is-empty")} />;
            return (
              <button
                key={`out-${output.itemId}`}
                type="button"
                className={cm(styles, "encyclopedia-recipe-row")}
                onClick={() => onItemClick(output.itemId)}
              >
                <img alt="" className={cm(styles, "encyclopedia-recipe-item-icon")} src={resolveItemIcon(output.itemId, index)} />
                <span className={cm(styles, "encyclopedia-recipe-item-name")}>{resolveItemName(output.itemId, index, t)}</span>
                <span className={cm(styles, "encyclopedia-recipe-item-amount")}>×{output.amount}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className={cm(styles, "encyclopedia-recipe-footer")}>
        <div className={cm(styles, "encyclopedia-recipe-metadata")}>
          <button
            type="button"
            className={cm(styles, "encyclopedia-recipe-machine")}
            onClick={() => onEntityClick(recipe.machineId)}
          >
            <img alt="" className={cm(styles, "encyclopedia-recipe-machine-icon")} src={resolveEntityIcon(recipe.machineId, index)} />
            <span className={cm(styles, "encyclopedia-recipe-machine-name")}>
              {resolveEntityDisplayName(recipe.machineId, index, t)}
            </span>
          </button>
          {conversion !== undefined && (
            <span className={cm(styles, "encyclopedia-tag")}>{t(recipe.nameKey)}</span>
          )}
          {requiredGasItemIds.map(requiredGasItemId => (
            <button
              type="button"
              key={requiredGasItemId}
              className={cm(styles, "encyclopedia-recipe-gas-environment")}
              onClick={() => onItemClick(requiredGasItemId)}
            >
              <img
                alt=""
                className={cm(styles, "encyclopedia-recipe-metadata-icon")}
                src={resolveItemIcon(requiredGasItemId, index)}
              />
              <span>
                {resolveItemName(requiredGasItemId, index, t)}
                {t("encyclopedia.recipe.gasEnvironmentSuffix")}
              </span>
            </button>
          ))}
          {consumedItemIds.length > 0 && (
            <div className={cm(styles, "encyclopedia-recipe-device-consumption")}>
              <span className={cm(styles, "encyclopedia-recipe-device-consumption-label")}>
                {consumptionLabel}
              </span>
              {consumedItemIds.map((itemId) => (
                <button
                  key={itemId}
                  type="button"
                  className={cm(styles, "encyclopedia-recipe-consumed-item")}
                  onClick={() => onItemClick(itemId)}
                >
                  <img
                    alt=""
                    className={cm(styles, "encyclopedia-recipe-metadata-icon")}
                    src={resolveItemIcon(itemId, index)}
                  />
                  <span>{resolveItemName(itemId, index, t)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <ActivityIconStrip activityIds={activityIds} />
        <div className={cm(styles, "encyclopedia-recipe-duration")}>
          {probabilityText !== null && (
            <span>{t(weight ? "encyclopedia.recipe.weight" : "encyclopedia.recipe.probability")} {probabilityText}</span>
          )}
          {layerProbabilityText !== null && (
            <span>{t("encyclopedia.recipe.layerProbability")} {layerProbabilityText}</span>
          )}
          <span>{durationSeconds}s</span>
        </div>
      </div>
    </article>
  );
}

function DetailView({
  entry,
  index,
  onItemClick,
  onEntityClick,
  onBack,
  expandedGroups,
  onToggleGroup,
  isTouch,
  showActivityIcons,
  locale,
  t,
}: {
  entry: NavEntry;
  index: EncyclopediaIndex;
  onItemClick: (id: string) => void;
  onEntityClick: (id: string) => void;
  onBack: () => void;
  expandedGroups: Set<string>;
  onToggleGroup: (group: string) => void;
  isTouch: boolean;
  showActivityIcons: boolean;
  locale: AppLocale;
  t: (key: string) => string;
}) {
  const isItem = entry.type === "item";
  const itemDef = isItem ? index.itemById.get(entry.id) : undefined;
  const entityDef = !isItem ? index.entityById.get(entry.id) : undefined;

  const name = isItem
    ? (itemDef ? t(itemDef.nameKey) : entry.id)
    : resolveEntityDisplayName(entry.id, index, t);

  const iconSrc = isItem
    ? resolveItemIcon(entry.id, index)
    : resolveEntityIcon(entry.id, index);

  const tags = isItem ? itemDef?.tags ?? [] : entityDef?.tags ?? [];
  const activityIds = showActivityIcons ? resolveActivityIdsFromTags(tags) : [];
  const visibleTags = showActivityIcons
    ? tags.filter((tag) => resolveActivityIdsFromTags([tag]).length === 0)
    : tags;

  const inputRecipes = isItem
    ? index.recipesByInputItem.get(entry.id) ?? []
    : [];
  const outputRecipes = isItem
    ? index.recipesByOutputItem.get(entry.id) ?? []
    : [];
  const machineRecipes = !isItem
    ? index.recipesByMachine.get(entry.id) ?? []
    : [];

  const liquidFillingRecipes = isItem
    ? dedupeRecipes([
      ...inputRecipes.filter((recipe) => hasRecipeTag(recipe, LIQUID_FILLING_RECIPE_TAG)),
      ...outputRecipes.filter((recipe) => hasRecipeTag(recipe, LIQUID_FILLING_RECIPE_TAG)),
    ])
    : machineRecipes.filter((recipe) => hasRecipeTag(recipe, LIQUID_FILLING_RECIPE_TAG));
  const liquidDismantleRecipes = isItem
    ? dedupeRecipes([
      ...inputRecipes.filter((recipe) => hasRecipeTag(recipe, LIQUID_DISMANTLE_RECIPE_TAG)),
      ...outputRecipes.filter((recipe) => hasRecipeTag(recipe, LIQUID_DISMANTLE_RECIPE_TAG)),
    ])
    : machineRecipes.filter((recipe) => hasRecipeTag(recipe, LIQUID_DISMANTLE_RECIPE_TAG));
  const asInputRecipes = inputRecipes.filter(
    (recipe) => !hasRecipeTag(recipe, LIQUID_FILLING_RECIPE_TAG)
      && !hasRecipeTag(recipe, LIQUID_DISMANTLE_RECIPE_TAG),
  );
  const asOutputRecipes = outputRecipes.filter(
    (recipe) => !hasRecipeTag(recipe, LIQUID_FILLING_RECIPE_TAG)
      && !hasRecipeTag(recipe, LIQUID_DISMANTLE_RECIPE_TAG),
  );
  const asMachineRecipes = machineRecipes.filter(
    (recipe) => !hasRecipeTag(recipe, LIQUID_FILLING_RECIPE_TAG)
      && !hasRecipeTag(recipe, LIQUID_DISMANTLE_RECIPE_TAG),
  );

  return (
    <div className={cm(styles, "encyclopedia-detail")}>
      <div className={cm(styles, "encyclopedia-detail-header")}>
        {isTouch && (
          <button
            type="button"
            className={cm(styles, "encyclopedia-back-button")}
            onClick={onBack}
          >
            ← {t("encyclopedia.back")}
          </button>
        )}
        <img alt="" className={cm(styles, "encyclopedia-detail-icon")} src={iconSrc} />
        <div className={cm(styles, "encyclopedia-detail-info")}>
          <h3 className={cm(styles, "encyclopedia-detail-name")}>{name}</h3>
          {isItem && (
            <span className={cm(styles, "encyclopedia-detail-kind")}>{t("encyclopedia.itemLabel")}</span>
          )}
          {!isItem && (
            <span className={cm(styles, "encyclopedia-detail-kind")}>{t("encyclopedia.entityLabel")}</span>
          )}
          {(visibleTags.length > 0 || activityIds.length > 0) && (
            <div className={cm(styles, "encyclopedia-detail-tags")}>
              {visibleTags.map((tag) => (
                <span key={tag} className={cm(styles, "encyclopedia-tag")}>{tag}</span>
              ))}
              <ActivityIconStrip activityIds={activityIds} />
            </div>
          )}
        </div>
      </div>

      <RecipeGroup
        title={t("encyclopedia.group.asOutput")}
        recipes={asOutputRecipes}
        focusItemId={isItem ? entry.id : undefined}
        index={index}
        onItemClick={onItemClick}
        onEntityClick={onEntityClick}
        isExpanded={expandedGroups.has("asOutput")}
        onToggle={() => onToggleGroup("asOutput")}
        showActivityIcons={showActivityIcons}
        locale={locale}
        t={t}
      />
      <RecipeGroup
        title={t("encyclopedia.group.asInput")}
        recipes={asInputRecipes}
        focusItemId={isItem ? entry.id : undefined}
        index={index}
        onItemClick={onItemClick}
        onEntityClick={onEntityClick}
        isExpanded={expandedGroups.has("asInput")}
        onToggle={() => onToggleGroup("asInput")}
        showActivityIcons={showActivityIcons}
        locale={locale}
        t={t}
      />
      <RecipeGroup
        title={t("encyclopedia.group.asMachine")}
        recipes={asMachineRecipes}
        index={index}
        onItemClick={onItemClick}
        onEntityClick={onEntityClick}
        isExpanded={expandedGroups.has("asMachine")}
        onToggle={() => onToggleGroup("asMachine")}
        showActivityIcons={showActivityIcons}
        locale={locale}
        t={t}
      />
      <RecipeGroup
        title={t("encyclopedia.group.liquidFilling")}
        recipes={liquidFillingRecipes}
        focusItemId={isItem ? entry.id : undefined}
        index={index}
        onItemClick={onItemClick}
        onEntityClick={onEntityClick}
        isExpanded={expandedGroups.has("liquidFilling")}
        onToggle={() => onToggleGroup("liquidFilling")}
        showActivityIcons={showActivityIcons}
        locale={locale}
        t={t}
      />
      <RecipeGroup
        title={t("encyclopedia.group.liquidDismantle")}
        recipes={liquidDismantleRecipes}
        focusItemId={isItem ? entry.id : undefined}
        index={index}
        onItemClick={onItemClick}
        onEntityClick={onEntityClick}
        isExpanded={expandedGroups.has("liquidDismantle")}
        onToggle={() => onToggleGroup("liquidDismantle")}
        showActivityIcons={showActivityIcons}
        locale={locale}
        t={t}
      />

      {asInputRecipes.length === 0
        && asOutputRecipes.length === 0
        && liquidFillingRecipes.length === 0
        && liquidDismantleRecipes.length === 0
        && asMachineRecipes.length === 0 && (
        <p className={cm(styles, "encyclopedia-empty")}>{t("encyclopedia.noRecipes")}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export const EncyclopediaPanel = observer(function EncyclopediaPanel({
  appHost,
  isTouch,
}: {
  appHost: AppHost;
  isTouch: boolean;
}) {
  const registry = appHost.workspace.registry;
  const t = appHost.actions.translate;
  const showAllActivityContent = appHost.internalState.settings.toolboxShowAllActivityContent;
  const selectedActivityIds = appHost.internalState.settings.selectedActivityIds;
  const effectiveActivityIds = resolveEffectiveActivityIds({
    selectedActivityIds,
  });

  const index = useMemo(
    () => {
      const items = showAllActivityContent
        ? registry.itemDefinitions
        : registry.itemDefinitions.filter((item) => isItemAvailableByActivity(item, effectiveActivityIds));
      const recipes = showAllActivityContent
        ? registry.recipeDefinitions
        : registry.recipeDefinitions.filter((recipe) => isRecipeAvailableByActivity(recipe, effectiveActivityIds));

      return buildEncyclopediaIndex(
        items,
        registry.entityDefinitions,
        recipes,
        registry.entityVariantDefinitions,
      );
    },
    [effectiveActivityIds, registry, showAllActivityContent],
  );

  const wikiState = appHost.internalState.workbench.toolbox.wiki;
  const navStack = wikiState.navigationStack;
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(["asInput", "asOutput", "liquidFilling", "liquidDismantle", "asMachine"]),
  );
  const openedPage = wikiState.openedPage;
  const openedPageId = openedPage.kind === "browser" ? null : openedPage.id;
  const currentEntry = useMemo(() => {
    if (openedPage.kind === "browser" || openedPageId === null) {
      return null;
    }

    return { type: openedPage.kind, id: openedPageId };
  }, [openedPage.kind, openedPageId]);

  const persistNavigation = useCallback((nextNavigationStack: NavEntry[]) => {
    runInAction(() => {
      wikiState.navigationStack = nextNavigationStack;
      const activeEntry = nextNavigationStack[nextNavigationStack.length - 1] ?? null;
      wikiState.openedPage = activeEntry === null
        ? { kind: "browser" }
        : { kind: activeEntry.type, id: activeEntry.id };
    });
  }, [wikiState]);

  const navigateTo = useCallback((entry: NavEntry | null) => {
    if (entry === null) {
      persistNavigation([]);
      return;
    }

    if (isSameNavigationEntry(currentEntry, entry)) {
      return;
    }

    persistNavigation([...wikiState.navigationStack, entry]);
  }, [currentEntry, persistNavigation, wikiState]);

  const navigateToIndex = useCallback((stackIndex: number) => {
    if (stackIndex < 0) {
      persistNavigation([]);
      return;
    }

    persistNavigation(wikiState.navigationStack.slice(0, stackIndex + 1));
  }, [persistNavigation, wikiState]);

  const handleBack = useCallback(() => {
    persistNavigation(wikiState.navigationStack.slice(0, -1));
  }, [persistNavigation, wikiState]);

  const handleItemClick = useCallback((itemId: string) => {
    navigateTo({ type: "item", id: itemId });
  }, [navigateTo]);

  const handleEntityClick = useCallback((entityId: string) => {
    navigateTo({ type: "entity", id: entityId });
  }, [navigateTo]);

  useEffect(() => {
    if (currentEntry === null) {
      return;
    }

    if (
      (currentEntry.type === "item" && !index.itemById.has(currentEntry.id))
      || (currentEntry.type === "entity" && !index.entityById.has(currentEntry.id))
    ) {
      persistNavigation([]);
    }
  }, [currentEntry, index, persistNavigation]);

  const toggleGroup = useCallback((group: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  }, []);

  // --- Render: Detail View ---
  if (currentEntry) {
    return (
      <div className={cm(styles, `encyclopedia-panel${isTouch ? " is-touch" : ""}`)}>
        <Breadcrumb
          stack={navStack}
          index={index}
          onNavigate={navigateToIndex}
          isTouch={isTouch}
          t={t}
        />
        <DetailView
          entry={currentEntry}
          index={index}
          onItemClick={handleItemClick}
          onEntityClick={handleEntityClick}
          onBack={handleBack}
          expandedGroups={expandedGroups}
          onToggleGroup={toggleGroup}
          isTouch={isTouch}
          showActivityIcons={showAllActivityContent}
          locale={appHost.state.settings.locale}
          t={t}
        />
      </div>
    );
  }
  return (
    <EncyclopediaBrowser
      customFilters={[]}
      desktopCategory={wikiState.desktopCategory}
      index={index}
      isTouch={isTouch}
      locale={appHost.state.settings.locale}
      mobileSelectedCategories={wikiState.mobileSelectedCategories}
      selectedCustomFilterIndex={null}
      onDesktopCategoryChange={(category) => {
        runInAction(() => {
          wikiState.desktopCategory = category;
        });
      }}
      onEntityClick={handleEntityClick}
      onItemClick={handleItemClick}
      onMobileSelectedCategoriesChange={(categories) => {
        runInAction(() => {
          wikiState.mobileSelectedCategories = categories;
        });
      }}
      onQueryChange={(nextQuery) => {
        runInAction(() => {
          wikiState.searchQuery = nextQuery;
        });
      }}
      onSelectedCustomFilterChange={() => {}}
      query={wikiState.searchQuery}
      t={t}
    />
  );
});
