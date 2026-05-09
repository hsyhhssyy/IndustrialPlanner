import {
  useCallback,
  useMemo,
  useState,
} from "react";
import { runInAction } from "mobx";
import { observer } from "mobx-react-lite";

import type { AppHost } from "@/app/host/app-host";
import type {
  ToolboxWikiNavigationEntry as NavEntry,
} from "@/domain/app/types/app-types";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import {
  EncyclopediaBrowser,
  type EncyclopediaIndex,
  buildEncyclopediaIndex,
  resolveEntityIcon,
  resolveItemIcon,
  resolveItemName,
} from "@/app/shell/encyclopedia/encyclopedia-browser";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isSameNavigationEntry(left: NavEntry | null, right: NavEntry | null): boolean {
  if (left === null || right === null) {
    return left === right;
  }

  return left.type === right.type && left.id === right.id;
}

const LIQUID_FILLING_RECIPE_TAG = "bottle_filling";
const LIQUID_DISMANTLE_RECIPE_TAG = "liquid_bottle_dismantle";

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
    return <span className="encyclopedia-breadcrumb-current">{t("encyclopedia.home")}</span>;
  }

  const chips = stack.map((entry, i) => {
    const label = entry.type === "item"
      ? resolveItemName(entry.id, index, t)
      : t(index.entityById.get(entry.id)?.nameKey ?? entry.id);
    const isLast = i === stack.length - 1;

    return (
      <span key={`${entry.type}-${entry.id}`} className="encyclopedia-breadcrumb-segment">
        <button
          type="button"
          className={`encyclopedia-breadcrumb-link${isLast ? " is-active" : ""}`}
          onClick={() => onNavigate(i)}
          disabled={isLast}
        >
          {label}
        </button>
        {!isLast && <span className="encyclopedia-breadcrumb-sep">/</span>}
      </span>
    );
  });

  return (
    <div className={`encyclopedia-breadcrumb${isTouch ? " is-touch" : ""}`}>
      <button
        type="button"
        className="encyclopedia-breadcrumb-link is-home"
        onClick={() => onNavigate(-1)}
      >
        {t("encyclopedia.home")}
      </button>
      <span className="encyclopedia-breadcrumb-sep">/</span>
      {chips}
    </div>
  );
}

function RecipeGroup({
  title,
  recipes,
  index,
  onItemClick,
  isExpanded,
  onToggle,
  onEntityClick,
  t,
}: {
  title: string;
  recipes: RecipeDefinition[];
  index: EncyclopediaIndex;
  onItemClick: (id: string) => void;
  onEntityClick: (id: string) => void;
  isExpanded: boolean;
  onToggle: () => void;
  t: (key: string) => string;
}) {
  if (recipes.length === 0) return null;

  const sorted = [...recipes].sort((a, b) => a.durationSeconds - b.durationSeconds);

  return (
    <section className="encyclopedia-recipe-group">
      <button
        type="button"
        className="encyclopedia-recipe-group-header"
        onClick={onToggle}
      >
        <span className="encyclopedia-recipe-group-arrow">{isExpanded ? "▾" : "▸"}</span>
        <span className="encyclopedia-recipe-group-title">{title}</span>
        <span className="encyclopedia-recipe-group-count">({sorted.length})</span>
      </button>
      {isExpanded && (
        <div className="encyclopedia-recipe-list">
          {sorted.map((recipe) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              index={index}
              onItemClick={onItemClick}
              onEntityClick={onEntityClick}
              t={t}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function RecipeCard({
  recipe,
  index,
  onItemClick,
  onEntityClick,
  t,
}: {
  recipe: RecipeDefinition;
  index: EncyclopediaIndex;
  onItemClick: (id: string) => void;
  onEntityClick: (id: string) => void;
  t: (key: string) => string;
}) {
  const maxRows = Math.max(recipe.inputs.length, recipe.outputs.length);

  return (
    <article className="encyclopedia-recipe-card definition-card">
      <div className="encyclopedia-recipe-table">
        {/* Input column */}
        <div className="encyclopedia-recipe-col is-input">
          {Array.from({ length: maxRows }).map((_, i) => {
            const input = recipe.inputs[i];
            if (!input) return <div key={`in-empty-${i}`} className="encyclopedia-recipe-row is-empty" />;
            return (
              <button
                key={`in-${input.itemId}`}
                type="button"
                className="encyclopedia-recipe-row"
                onClick={() => onItemClick(input.itemId)}
              >
                <img alt="" className="encyclopedia-recipe-item-icon" src={resolveItemIcon(input.itemId, index)} />
                <span className="encyclopedia-recipe-item-name">{resolveItemName(input.itemId, index, t)}</span>
                <span className="encyclopedia-recipe-item-amount">×{input.amount}</span>
              </button>
            );
          })}
        </div>

        {/* Arrow */}
        <div className="encyclopedia-recipe-arrow-col">
          <span className="encyclopedia-recipe-arrow">→</span>
        </div>

        {/* Output column */}
        <div className="encyclopedia-recipe-col is-output">
          {Array.from({ length: maxRows }).map((_, i) => {
            const output = recipe.outputs[i];
            if (!output) return <div key={`out-empty-${i}`} className="encyclopedia-recipe-row is-empty" />;
            return (
              <button
                key={`out-${output.itemId}`}
                type="button"
                className="encyclopedia-recipe-row"
                onClick={() => onItemClick(output.itemId)}
              >
                <img alt="" className="encyclopedia-recipe-item-icon" src={resolveItemIcon(output.itemId, index)} />
                <span className="encyclopedia-recipe-item-name">{resolveItemName(output.itemId, index, t)}</span>
                <span className="encyclopedia-recipe-item-amount">×{output.amount}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="encyclopedia-recipe-footer">
        <button
          type="button"
          className="encyclopedia-recipe-machine"
          onClick={() => onEntityClick(recipe.machineId)}
        >
          <img alt="" className="encyclopedia-recipe-machine-icon" src={resolveEntityIcon(recipe.machineId)} />
          <span className="encyclopedia-recipe-machine-name">
            {t(index.entityById.get(recipe.machineId)?.nameKey ?? recipe.machineId)}
          </span>
        </button>
        <span className="encyclopedia-recipe-duration">{recipe.durationSeconds}s</span>
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
  t: (key: string) => string;
}) {
  const isItem = entry.type === "item";
  const itemDef = isItem ? index.itemById.get(entry.id) : undefined;
  const entityDef = !isItem ? index.entityById.get(entry.id) : undefined;

  const name = isItem
    ? (itemDef ? t(itemDef.nameKey) : entry.id)
    : (entityDef ? t(entityDef.nameKey) : entry.id);

  const iconSrc = isItem
    ? resolveItemIcon(entry.id, index)
    : resolveEntityIcon(entry.id);

  const tags = isItem ? itemDef?.tags ?? [] : entityDef?.tags ?? [];

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
    <div className="encyclopedia-detail">
      <div className="encyclopedia-detail-header">
        {isTouch && (
          <button
            type="button"
            className="encyclopedia-back-button"
            onClick={onBack}
          >
            ← {t("encyclopedia.back")}
          </button>
        )}
        <img alt="" className="encyclopedia-detail-icon" src={iconSrc} />
        <div className="encyclopedia-detail-info">
          <h3 className="encyclopedia-detail-name">{name}</h3>
          {isItem && (
            <span className="encyclopedia-detail-kind">{t("encyclopedia.itemLabel")}</span>
          )}
          {!isItem && (
            <span className="encyclopedia-detail-kind">{t("encyclopedia.entityLabel")}</span>
          )}
          {tags.length > 0 && (
            <div className="encyclopedia-detail-tags">
              {tags.map((tag) => (
                <span key={tag} className="encyclopedia-tag">{tag}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      <RecipeGroup
        title={t("encyclopedia.group.asOutput")}
        recipes={asOutputRecipes}
        index={index}
        onItemClick={onItemClick}
        onEntityClick={onEntityClick}
        isExpanded={expandedGroups.has("asOutput")}
        onToggle={() => onToggleGroup("asOutput")}
        t={t}
      />
      <RecipeGroup
        title={t("encyclopedia.group.asInput")}
        recipes={asInputRecipes}
        index={index}
        onItemClick={onItemClick}
        onEntityClick={onEntityClick}
        isExpanded={expandedGroups.has("asInput")}
        onToggle={() => onToggleGroup("asInput")}
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
        t={t}
      />
      <RecipeGroup
        title={t("encyclopedia.group.liquidFilling")}
        recipes={liquidFillingRecipes}
        index={index}
        onItemClick={onItemClick}
        onEntityClick={onEntityClick}
        isExpanded={expandedGroups.has("liquidFilling")}
        onToggle={() => onToggleGroup("liquidFilling")}
        t={t}
      />
      <RecipeGroup
        title={t("encyclopedia.group.liquidDismantle")}
        recipes={liquidDismantleRecipes}
        index={index}
        onItemClick={onItemClick}
        onEntityClick={onEntityClick}
        isExpanded={expandedGroups.has("liquidDismantle")}
        onToggle={() => onToggleGroup("liquidDismantle")}
        t={t}
      />

      {asInputRecipes.length === 0
        && asOutputRecipes.length === 0
        && liquidFillingRecipes.length === 0
        && liquidDismantleRecipes.length === 0
        && asMachineRecipes.length === 0 && (
        <p className="encyclopedia-empty">{t("encyclopedia.noRecipes")}</p>
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

  const index = useMemo(
    () => buildEncyclopediaIndex(
      registry.itemDefinitions,
      registry.entityDefinitions,
      registry.recipeDefinitions,
    ),
    [registry],
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
      <div className={`encyclopedia-panel${isTouch ? " is-touch" : ""}`}>
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
          t={t}
        />
      </div>
    );
  }
  return (
    <EncyclopediaBrowser
      desktopCategory={wikiState.desktopCategory}
      index={index}
      isTouch={isTouch}
      mobileSelectedCategories={wikiState.mobileSelectedCategories}
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
      query={wikiState.searchQuery}
      t={t}
    />
  );
});
