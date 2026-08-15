import { useEffect, useMemo, useRef, useState } from "react";
import { pinyin } from "pinyin-pro";

import type { AppLocale } from "@/domain/app/types/app-types";
import type {
  CustomFilter,
  ToolboxWikiDesktopCategory as CategoryType,
  ToolboxWikiEntityGroupCategory,
  ToolboxWikiMobileCategory as FilterableCategory,
  ToolboxWikiMobileFilterOption,
} from "@/app/toolbox-types";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { EntityVariantDefinition } from "@/domain/registry/types/entity-variant-definition";
import type { ItemDefinition } from "@/domain/registry/types/item-definition";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import { createDeviceIconAssetUrl, createItemIconAssetUrl } from "@/shared/browser/public-asset-url";
import { resolveEntityVariantName } from "@/shared/entity-variants";
import { isRecipeVisibleInToolbox } from "@/shared/registry/recipe-visibility";
import { CONSUMPTION_RECIPE_TAG } from "@/shared/consumption-channel";
import { lookupText } from "@/shared/i18n";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

export const ENTITY_UI_GROUP_ORDER: ToolboxWikiEntityGroupCategory[] = [
  "basicProduction",
  "advancedManufacturing",
  "beltLogistics",
  "pipeLogistics",
  "resourcePower",
  "warehouse",
];

export const EXCLUDE_BOTTLED_LIQUID_FILTER = "excludeBottledLiquid" as const;
export const BOTTLED_LIQUID_TAG = "瓶装液体";

export const MOBILE_FILTERABLE_CATEGORY_ORDER: ToolboxWikiMobileFilterOption[] = [
  EXCLUDE_BOTTLED_LIQUID_FILTER,
  "item",
  "entity",
  ...ENTITY_UI_GROUP_ORDER,
];

export interface EncyclopediaIndex {
  itemById: Map<string, ItemDefinition>;
  entityById: Map<string, EntityDefinition>;
  recipesByInputItem: Map<string, RecipeDefinition[]>;
  recipesByOutputItem: Map<string, RecipeDefinition[]>;
  recipesByMachine: Map<string, RecipeDefinition[]>;
  consumptionItemIdsByMachine: Map<string, readonly string[]>;
  allItems: ItemDefinition[];
  allEntities: EntityDefinition[];
  /** 拼音全拼索引（无音调），key 为 item/entity id，仅中文名非空时有值 */
  itemPinyin: Map<string, { full: string; initial: string }>;
  entityPinyin: Map<string, { full: string; initial: string }>;
  /** 设备变体定义，用于拼接变体短名称；未提供时仅显示基础名称 */
  entityVariantDefinitions?: Readonly<Record<string, EntityVariantDefinition>>;
}

export interface EncyclopediaBrowserProps {
  index: EncyclopediaIndex;
  isTouch: boolean;
  locale: AppLocale;
  query: string;
  desktopCategory: CategoryType;
  mobileSelectedCategories: ToolboxWikiMobileFilterOption[];
  recentItemIds?: string[];
  customFilters?: readonly CustomFilter[];
  selectedCustomFilterIndex: number | null;
  onQueryChange: (query: string) => void;
  onDesktopCategoryChange: (category: CategoryType) => void;
  onMobileSelectedCategoriesChange: (categories: ToolboxWikiMobileFilterOption[]) => void;
  onSelectedCustomFilterChange: (index: number | null) => void;
  onItemClick: (id: string) => void;
  onEntityClick: (id: string) => void;
  itemFilter?: (item: ItemDefinition) => boolean;
  entityFilter?: (entity: EntityDefinition) => boolean;
  autoFocusSearch?: boolean;
  t: (key: string) => string;
}

export function buildEncyclopediaIndex(
  items: ItemDefinition[],
  entities: EntityDefinition[],
  recipes: RecipeDefinition[],
  entityVariantDefinitions?: Readonly<Record<string, EntityVariantDefinition>>,
): EncyclopediaIndex {
  const encyclopediaEntities = entities.filter((entity) => entity.uiGroup !== "cheat");
  const itemById = new Map<string, ItemDefinition>();
  for (const item of items) {
    itemById.set(item.id, item);
  }

  const entityById = new Map<string, EntityDefinition>();
  for (const entity of encyclopediaEntities) {
    entityById.set(entity.id, entity);
  }

  // 构建拼音索引：始终基于 zh-CN 中文名，使用与 translate 相同的两级查找
  const itemPinyin = new Map<string, { full: string; initial: string }>();
  for (const item of items) {
    const zhName = lookupText("zh-CN", item.nameKey);
    if (zhName && zhName.length > 0) {
      const full = pinyin(zhName, { toneType: "none", separator: "" });
      const initial = pinyin(zhName, { pattern: "first", toneType: "none", separator: "" });
      if (full.length > 0) {
        itemPinyin.set(item.id, { full, initial });
      }
    }
  }

  const entityPinyin = new Map<string, { full: string; initial: string }>();
  for (const entity of encyclopediaEntities) {
    const zhName = lookupText("zh-CN", entity.nameKey);
    if (zhName && zhName.length > 0) {
      const full = pinyin(zhName, { toneType: "none", separator: "" });
      const initial = pinyin(zhName, { pattern: "first", toneType: "none", separator: "" });
      if (full.length > 0) {
        entityPinyin.set(entity.id, { full, initial });
      }
    }
  }

  const recipesByInputItem = new Map<string, RecipeDefinition[]>();
  const recipesByOutputItem = new Map<string, RecipeDefinition[]>();
  const recipesByMachine = new Map<string, RecipeDefinition[]>();
  const consumptionItemIdsByMachine = new Map<string, readonly string[]>();
  const visibleRecipes = recipes.filter(isRecipeVisibleInToolbox);

  for (const recipe of recipes) {
    if (!recipe.tags.includes(CONSUMPTION_RECIPE_TAG)) {
      continue;
    }
    const itemIds = new Set(consumptionItemIdsByMachine.get(recipe.machineId) ?? []);
    for (const input of recipe.inputs) {
      itemIds.add(input.itemId);
    }
    consumptionItemIdsByMachine.set(recipe.machineId, [...itemIds].sort());
  }

  for (const recipe of visibleRecipes) {
    for (const input of recipe.inputs) {
      const arr = recipesByInputItem.get(input.itemId);
      if (arr) {
        arr.push(recipe);
      } else {
        recipesByInputItem.set(input.itemId, [recipe]);
      }
    }
    for (const output of recipe.outputs) {
      const arr = recipesByOutputItem.get(output.itemId);
      if (arr) {
        arr.push(recipe);
      } else {
        recipesByOutputItem.set(output.itemId, [recipe]);
      }
    }
    const arr = recipesByMachine.get(recipe.machineId);
    if (arr) {
      arr.push(recipe);
    } else {
      recipesByMachine.set(recipe.machineId, [recipe]);
    }
  }

  return {
    itemById,
    entityById,
    recipesByInputItem,
    recipesByOutputItem,
    recipesByMachine,
    consumptionItemIdsByMachine,
    allItems: items,
    allEntities: encyclopediaEntities
      .filter((entity) => entity.uiGroup !== "hidden")
      .sort((a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id)),
    itemPinyin,
    entityPinyin,
    entityVariantDefinitions,
  };
}

export function resolveItemName(
  itemId: string,
  index: EncyclopediaIndex,
  t: (key: string) => string,
): string {
  const def = index.itemById.get(itemId);
  return def ? t(def.nameKey) : itemId;
}

export function resolveItemIcon(itemId: string, index: EncyclopediaIndex): string {
  const def = index.itemById.get(itemId);
  const iconId = def?.iconId ?? itemId;
  return createItemIconAssetUrl(iconId);
}

export function resolveEntityIcon(entityId: string, index: EncyclopediaIndex): string {
  return createDeviceIconAssetUrl(index.entityById.get(entityId)?.spriteId ?? entityId);
}

export function resolveEntityDisplayName(
  entityId: string,
  index: EncyclopediaIndex,
  t: (key: string) => string,
): string {
  const def = index.entityById.get(entityId);
  if (!def) return entityId;

  const baseName = t(def.nameKey);
  const variantDefs = index.entityVariantDefinitions;
  if (!variantDefs) return baseName;

  const variantName = resolveEntityVariantName(def);
  if (!variantName) return baseName;

  const variantDef = variantDefs[variantName];
  if (!variantDef) return baseName;

  const shortName = t(variantDef.shortNameKey);
  if (!shortName) return baseName;

  return `${baseName} · ${shortName}`;
}

export function isMobileDisplayCategory(
  category: ToolboxWikiMobileFilterOption,
): category is FilterableCategory {
  return category === "item"
    || category === "entity"
    || ENTITY_UI_GROUP_ORDER.includes(category as ToolboxWikiEntityGroupCategory);
}

function resolveCategoryLabel(
  category: CategoryType | ToolboxWikiMobileFilterOption,
  t: (key: string) => string,
): string {
  switch (category) {
    case "all":
      return t("encyclopedia.category.all");
    case EXCLUDE_BOTTLED_LIQUID_FILTER:
      return t("encyclopedia.filter.excludeBottledLiquid");
    case "item":
      return t("encyclopedia.category.items");
    case "entity":
      return t("encyclopedia.category.entities");
    default:
      return t(`uiGroup.${category}`);
  }
}

function includesSearchQuery(
  name: string,
  tags: readonly string[],
  query: string,
): boolean {
  if (query.length === 0) {
    return true;
  }

  if (name.toLowerCase().includes(query)) {
    return true;
  }

  return tags.some((tag) => tag.toLowerCase().includes(query));
}

function matchesPinyinSearch(
  pinyinData: { full: string; initial: string } | undefined,
  query: string,
): boolean {
  if (!pinyinData) return false;
  return pinyinData.full.includes(query) || pinyinData.initial.includes(query);
}

function isBottledLiquid(item: ItemDefinition): boolean {
  return item.tags.includes(BOTTLED_LIQUID_TAG);
}

function arraysEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function normalizeMobileSelectedCategories(
  selectedCategories: readonly ToolboxWikiMobileFilterOption[],
  availableCategories: ReadonlySet<ToolboxWikiMobileFilterOption>,
): ToolboxWikiMobileFilterOption[] {
  const nextSelected = new Set<ToolboxWikiMobileFilterOption>();
  for (const category of selectedCategories) {
    if (availableCategories.has(category)) {
      nextSelected.add(category);
    }
  }

  return MOBILE_FILTERABLE_CATEGORY_ORDER.filter((category) => nextSelected.has(category));
}

function SearchBar({
  autoFocus = false,
  query,
  onChange,
  t,
}: {
  autoFocus?: boolean;
  query: string;
  onChange: (query: string) => void;
  t: (key: string) => string;
}) {
  return (
    <div className={cm(styles, "encyclopedia-search")}>
      <input
        autoFocus={autoFocus}
        type="text"
        className={cm(styles, "encyclopedia-search-input")}
        placeholder={t("encyclopedia.searchPlaceholder")}
        value={query}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function CardGrid({
  items,
  entities,
  index,
  onItemClick,
  onEntityClick,
  t,
}: {
  items: ItemDefinition[];
  entities: EntityDefinition[];
  index: EncyclopediaIndex;
  onItemClick: (id: string) => void;
  onEntityClick: (id: string) => void;
  t: (key: string) => string;
}) {
  if (items.length === 0 && entities.length === 0) {
    return <p className={cm(styles, "encyclopedia-empty")}>{t("encyclopedia.noResults")}</p>;
  }

  return (
    <div className={cm(styles, "encyclopedia-card-grid")}>
      {entities.map((entity) => (
        <button
          key={`entity-${entity.id}`}
          type="button"
          className={cm(styles, "encyclopedia-card")}
          onClick={() => onEntityClick(entity.id)}
        >
          <img
            alt=""
            className={cm(styles, "encyclopedia-card-icon")}
            src={resolveEntityIcon(entity.id, index)}
          />
          <span className={cm(styles, "encyclopedia-card-label")}>{resolveEntityDisplayName(entity.id, index, t)}</span>
          <span className={cm(styles, "encyclopedia-card-kind")}>{t("encyclopedia.entityLabel")}</span>
        </button>
      ))}
      {items.map((item) => (
        <button
          key={`item-${item.id}`}
          type="button"
          className={cm(styles, "encyclopedia-card")}
          onClick={() => onItemClick(item.id)}
        >
          <img
            alt=""
            className={cm(styles, "encyclopedia-card-icon")}
            src={resolveItemIcon(item.id, index)}
          />
          <span className={cm(styles, "encyclopedia-card-label")}>{t(item.nameKey)}</span>
        </button>
      ))}
    </div>
  );
}

function RecentItemsRow({
  items,
  index,
  onItemClick,
  t,
}: {
  items: ItemDefinition[];
  index: EncyclopediaIndex;
  onItemClick: (id: string) => void;
  t: (key: string) => string;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className={cm(styles, "encyclopedia-recent-section")}>
      <h3 className={cm(styles, "encyclopedia-recent-heading")}>
        {t("encyclopedia.recentItems")}
        <span className={cm(styles, "encyclopedia-recent-count")}>{items.length}</span>
      </h3>
      <div className={cm(styles, "encyclopedia-recent-row")}>
        {items.map((item) => (
          <button
            key={`recent-${item.id}`}
            type="button"
            className={cm(styles, "encyclopedia-recent-card")}
            onClick={() => onItemClick(item.id)}
          >
            <img
              alt=""
              className={cm(styles, "encyclopedia-card-icon")}
              src={resolveItemIcon(item.id, index)}
            />
            <span className={cm(styles, "encyclopedia-card-label")}>{t(item.nameKey)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function SidebarCategories({
  activeCategory,
  availableCategories,
  customFilters,
  selectedCustomFilterIndex,
  onChange,
  onCustomFilterChange,
  t,
}: {
  activeCategory: CategoryType;
  availableCategories: readonly CategoryType[];
  customFilters: readonly CustomFilter[];
  selectedCustomFilterIndex: number | null;
  onChange: (category: CategoryType) => void;
  onCustomFilterChange: (index: number | null) => void;
  t: (key: string) => string;
}) {
  const availableSet = useMemo(
    () => new Set<CategoryType>(availableCategories),
    [availableCategories],
  );
  const primaryGroups: Array<{ id: CategoryType; label: string }> = [
    { id: "all" as CategoryType, label: t("encyclopedia.category.all") },
    { id: "item" as CategoryType, label: t("encyclopedia.category.items") },
    { id: "entity" as CategoryType, label: t("encyclopedia.category.entities") },
  ].filter((group) => availableSet.has(group.id));

  const entitySubgroups = ENTITY_UI_GROUP_ORDER
    .filter((group) => availableSet.has(group))
    .map((group) => ({
      id: group as CategoryType,
      label: t(`uiGroup.${group}`),
    }));

  const hasCustomFilters = customFilters.length > 0;

  return (
    <div className={cm(styles, "encyclopedia-category-list")}>
      {primaryGroups.map((group) => (
        <CategoryButton
          key={group.id}
          id={group.id}
          label={group.label}
          isActive={activeCategory === group.id}
          onChange={onChange}
        />
      ))}
      {entitySubgroups.length > 0 ? <hr className={cm(styles, "encyclopedia-sidebar-divider")} /> : null}
      {entitySubgroups.map((group) => (
        <CategoryButton
          key={group.id}
          id={group.id}
          label={group.label}
          isActive={activeCategory === group.id}
          onChange={onChange}
        />
      ))}
      {hasCustomFilters ? <hr className={cm(styles, "encyclopedia-sidebar-divider")} /> : null}
      {customFilters.map((filter, index) => (
        <button
          key={`custom-${index}`}
          type="button"
          className={cm(styles, `encyclopedia-category-button${selectedCustomFilterIndex === index ? " is-active" : ""}`)}
          onClick={() => onCustomFilterChange(selectedCustomFilterIndex === index ? null : index)}
        >
          {t(filter.i18nKey)}
        </button>
      ))}
    </div>
  );
}

function CategoryDropdown({
  availableCategories,
  customFilters,
  isOpen,
  onChange,
  onClose,
  onCustomFilterChange,
  onToggle,
  selectedCategories,
  selectedCustomFilterIndex,
  t,
}: {
  availableCategories: readonly ToolboxWikiMobileFilterOption[];
  customFilters: readonly CustomFilter[];
  isOpen: boolean;
  onChange: (categories: ToolboxWikiMobileFilterOption[]) => void;
  onClose: () => void;
  onCustomFilterChange: (index: number | null) => void;
  onToggle: () => void;
  selectedCategories: readonly ToolboxWikiMobileFilterOption[];
  selectedCustomFilterIndex: number | null;
  t: (key: string) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen, onClose]);

  const selectedSet = useMemo(
    () => new Set<ToolboxWikiMobileFilterOption>(selectedCategories),
    [selectedCategories],
  );
  const options = availableCategories.map((category) => ({
    id: category,
    label: resolveCategoryLabel(category, t),
  }));
  const selectedOptions = options.filter((option) => selectedSet.has(option.id));
  const isFiltered = selectedCategories.length > 0;
  const primarySelectedLabel = selectedOptions[0]?.label ?? t("encyclopedia.filter.label");
  const summaryLabel = !isFiltered
    ? t("encyclopedia.category.all")
    : selectedOptions.length === 1
      ? primarySelectedLabel
      : `${primarySelectedLabel} +${selectedOptions.length - 1}`;

  return (
    <div className={cm(styles, "encyclopedia-category-dropdown")} ref={ref}>
      <button
        type="button"
        className={cm(styles, `encyclopedia-category-dropdown-trigger${isFiltered ? " is-filtered" : ""}`)}
        onClick={onToggle}
      >
        <span className={cm(styles, "encyclopedia-category-dropdown-copy")}>
          <span className={cm(styles, "encyclopedia-category-dropdown-title")}>{t("encyclopedia.filter.label")}</span>
          <span className={cm(styles, "encyclopedia-category-dropdown-label")}>{summaryLabel}</span>
        </span>
        <span className={cm(styles, "encyclopedia-category-dropdown-meta")}>
          {isFiltered ? (
            <span className={cm(styles, "encyclopedia-category-dropdown-badge")}>{selectedCategories.length}</span>
          ) : null}
          <span className={cm(styles, `encyclopedia-category-dropdown-arrow${isOpen ? " is-open" : ""}`)}>▾</span>
        </span>
      </button>
      {isOpen ? (
        <div className={cm(styles, "encyclopedia-category-dropdown-menu")}>
          <button
            type="button"
            className={cm(styles, `encyclopedia-category-dropdown-item${!isFiltered ? " is-active" : ""}`)}
            onClick={() => onChange([])}
          >
            <span>{t("encyclopedia.category.all")}</span>
            <span className={cm(styles, "encyclopedia-category-dropdown-check")}>{!isFiltered ? "✓" : ""}</span>
          </button>
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              className={cm(styles, `encyclopedia-category-dropdown-item${selectedSet.has(option.id) ? " is-active" : ""}`)}
              onClick={() => {
                const nextSelected = new Set(selectedCategories);
                if (nextSelected.has(option.id)) {
                  nextSelected.delete(option.id);
                } else {
                  nextSelected.add(option.id);
                }
                onChange(MOBILE_FILTERABLE_CATEGORY_ORDER.filter((category) => nextSelected.has(category)));
              }}
            >
              <span>{option.label}</span>
              <span className={cm(styles, "encyclopedia-category-dropdown-check")}>
                {selectedSet.has(option.id) ? "✓" : ""}
              </span>
            </button>
          ))}
          {customFilters.length > 0 ? (
            <>
              <hr className={cm(styles, "encyclopedia-sidebar-divider")} />
              {customFilters.map((filter, index) => (
                <button
                  key={`custom-${index}`}
                  type="button"
                  className={cm(styles, `encyclopedia-category-dropdown-item${selectedCustomFilterIndex === index ? " is-active" : ""}`)}
                  onClick={() => {
                    onCustomFilterChange(selectedCustomFilterIndex === index ? null : index);
                    onClose();
                  }}
                >
                  <span>{t(filter.i18nKey)}</span>
                  <span className={cm(styles, "encyclopedia-category-dropdown-check")}>
                    {selectedCustomFilterIndex === index ? "✓" : ""}
                  </span>
                </button>
              ))}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CategoryButton({
  id,
  isActive,
  label,
  onChange,
}: {
  id: CategoryType;
  isActive: boolean;
  label: string;
  onChange: (category: CategoryType) => void;
}) {
  return (
    <button
      type="button"
      className={cm(styles, `encyclopedia-category-button${isActive ? " is-active" : ""}`)}
      onClick={() => onChange(id)}
    >
      {label}
    </button>
  );
}

export function EncyclopediaBrowser({
  autoFocusSearch = false,
  customFilters,
  desktopCategory,
  entityFilter,
  index,
  isTouch,
  itemFilter,
  locale,
  mobileSelectedCategories,
  recentItemIds,
  selectedCustomFilterIndex,
  onDesktopCategoryChange,
  onEntityClick,
  onItemClick,
  onMobileSelectedCategoriesChange,
  onQueryChange,
  onSelectedCustomFilterChange,
  query,
  t,
}: EncyclopediaBrowserProps) {
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const normalizedQuery = query.trim().toLowerCase();
  const isZhLocale = locale === "zh-CN";
  const selectedMobileFilters = useMemo(
    () => new Set<ToolboxWikiMobileFilterOption>(mobileSelectedCategories),
    [mobileSelectedCategories],
  );
  const selectedMobileCategories = useMemo(
    () => new Set<FilterableCategory>(mobileSelectedCategories.filter(isMobileDisplayCategory)),
    [mobileSelectedCategories],
  );

  const searchMatchedItems = useMemo(
    () => index.allItems.filter((item) => {
      if (itemFilter !== undefined && !itemFilter(item)) {
        return false;
      }

      if (includesSearchQuery(t(item.nameKey), item.tags, normalizedQuery)) {
        return true;
      }

      if (isZhLocale && normalizedQuery.length > 0) {
        return matchesPinyinSearch(index.itemPinyin.get(item.id), normalizedQuery);
      }

      return false;
    }),
    [index, itemFilter, normalizedQuery, t, isZhLocale],
  );

  const searchMatchedEntities = useMemo(
    () => index.allEntities.filter((entity) => {
      if (entityFilter !== undefined && !entityFilter(entity)) {
        return false;
      }

      if (includesSearchQuery(t(entity.nameKey), entity.tags, normalizedQuery)) {
        return true;
      }

      if (isZhLocale && normalizedQuery.length > 0) {
        return matchesPinyinSearch(index.entityPinyin.get(entity.id), normalizedQuery);
      }

      return false;
    }),
    [entityFilter, index, normalizedQuery, t, isZhLocale],
  );

  const availableDesktopCategories = useMemo(() => {
    const categories: CategoryType[] = ["all"];

    if (searchMatchedItems.length > 0) {
      categories.push("item");
    }

    if (searchMatchedEntities.length > 0) {
      categories.push("entity");
    }

    for (const group of ENTITY_UI_GROUP_ORDER) {
      if (searchMatchedEntities.some((entity) => entity.uiGroup === group)) {
        categories.push(group);
      }
    }

    return categories;
  }, [searchMatchedEntities, searchMatchedItems]);
  const availableDesktopCategorySet = useMemo(
    () => new Set<CategoryType>(availableDesktopCategories),
    [availableDesktopCategories],
  );

  const availableMobileCategories = useMemo(() => {
    const categories: ToolboxWikiMobileFilterOption[] = [];

    if (searchMatchedItems.some(isBottledLiquid)) {
      categories.push(EXCLUDE_BOTTLED_LIQUID_FILTER);
    }

    if (searchMatchedItems.length > 0) {
      categories.push("item");
    }

    if (searchMatchedEntities.length > 0) {
      categories.push("entity");
    }

    for (const group of ENTITY_UI_GROUP_ORDER) {
      if (searchMatchedEntities.some((entity) => entity.uiGroup === group)) {
        categories.push(group);
      }
    }

    return categories;
  }, [searchMatchedEntities, searchMatchedItems]);
  const availableMobileCategorySet = useMemo(
    () => new Set<ToolboxWikiMobileFilterOption>(availableMobileCategories),
    [availableMobileCategories],
  );

  useEffect(() => {
    if (isTouch || availableDesktopCategorySet.has(desktopCategory)) {
      return;
    }

    onDesktopCategoryChange(availableDesktopCategories[0] ?? "all");
  }, [
    availableDesktopCategories,
    availableDesktopCategorySet,
    desktopCategory,
    isTouch,
    onDesktopCategoryChange,
  ]);

  useEffect(() => {
    if (!isTouch) {
      return;
    }

    const normalizedSelectedCategories = normalizeMobileSelectedCategories(
      mobileSelectedCategories,
      availableMobileCategorySet,
    );

    if (arraysEqual(normalizedSelectedCategories, mobileSelectedCategories)) {
      return;
    }

    onMobileSelectedCategoriesChange(normalizedSelectedCategories);
  }, [
    availableMobileCategorySet,
    isTouch,
    mobileSelectedCategories,
    onMobileSelectedCategoriesChange,
  ]);

  const recentFilteredItems = useMemo(() => {
    if (!recentItemIds || recentItemIds.length === 0) {
      return [];
    }

    const searchItemSet = new Set(searchMatchedItems.map((item) => item.id));
    return recentItemIds
      .filter((id) => searchItemSet.has(id))
      .map((id) => index.itemById.get(id))
      .filter((v): v is ItemDefinition => v !== undefined);
  }, [index, recentItemIds, searchMatchedItems]);

  const filteredItems = useMemo(() => {
    let items = searchMatchedItems;

    if (isTouch) {
      if (selectedMobileFilters.has(EXCLUDE_BOTTLED_LIQUID_FILTER)) {
        items = items.filter((item) => !isBottledLiquid(item));
      }

      if (selectedMobileCategories.size === 0) {
        // 自定义筛选叠加：在现有分类过滤结果上进一步收窄
        if (selectedCustomFilterIndex !== null) {
          const allowedIds = new Set(customFilters?.[selectedCustomFilterIndex]?.itemIds ?? []);
          items = items.filter((item) => allowedIds.has(item.id));
        }
        return items;
      }

      const result = selectedMobileCategories.has("item") ? items : [];
      if (result.length > 0 && selectedCustomFilterIndex !== null) {
        const allowedIds = new Set(customFilters?.[selectedCustomFilterIndex]?.itemIds ?? []);
        return result.filter((item) => allowedIds.has(item.id));
      }
      return result;
    }

    if (desktopCategory !== "all" && desktopCategory !== "item" && desktopCategory !== "entity") {
      return [];
    }

    const result = desktopCategory === "entity" ? [] : items;
    if (result.length > 0 && selectedCustomFilterIndex !== null) {
      const allowedIds = new Set(customFilters?.[selectedCustomFilterIndex]?.itemIds ?? []);
      return result.filter((item) => allowedIds.has(item.id));
    }
    return result;
  }, [
    customFilters,
    desktopCategory,
    isTouch,
    searchMatchedItems,
    selectedCustomFilterIndex,
    selectedMobileCategories,
    selectedMobileFilters,
  ]);

  const filteredEntities = useMemo(() => {
    let entities = searchMatchedEntities;

    if (isTouch) {
      if (selectedMobileCategories.size === 0 || selectedMobileCategories.has("entity")) {
        return entities;
      }

      const selectedGroups = ENTITY_UI_GROUP_ORDER.filter((group) => selectedMobileCategories.has(group));
      if (selectedGroups.length === 0) {
        return [];
      }

      const selectedGroupSet = new Set(selectedGroups);
      return entities.filter((entity) => selectedGroupSet.has(entity.uiGroup as ToolboxWikiEntityGroupCategory));
    }

    if (desktopCategory !== "all" && desktopCategory !== "entity") {
      if (ENTITY_UI_GROUP_ORDER.includes(desktopCategory as ToolboxWikiEntityGroupCategory)) {
        entities = entities.filter((entity) => entity.uiGroup === desktopCategory);
      } else if (desktopCategory === "item") {
        return [];
      }
    }

    return entities;
  }, [desktopCategory, isTouch, searchMatchedEntities, selectedMobileCategories]);

  if (!isTouch) {
    return (
      <div className={cm(styles, "encyclopedia-panel")}>
        <SearchBar
          autoFocus={autoFocusSearch}
          query={query}
          onChange={onQueryChange}
          t={t}
        />
        <div className={cm(styles, "encyclopedia-pc-layout")}>
          <nav className={cm(styles, "encyclopedia-sidebar")}>
            <SidebarCategories
              activeCategory={desktopCategory}
              availableCategories={availableDesktopCategories}
              customFilters={customFilters ?? []}
              selectedCustomFilterIndex={selectedCustomFilterIndex}
              onChange={onDesktopCategoryChange}
              onCustomFilterChange={onSelectedCustomFilterChange}
              t={t}
            />
          </nav>
          <main className={cm(styles, "encyclopedia-main")}>
            <RecentItemsRow
              items={recentFilteredItems}
              index={index}
              onItemClick={onItemClick}
              t={t}
            />
            <CardGrid
              items={filteredItems}
              entities={filteredEntities}
              index={index}
              onItemClick={onItemClick}
              onEntityClick={onEntityClick}
              t={t}
            />
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className={cm(styles, "encyclopedia-panel is-touch is-browser")}>
      <div className={cm(styles, "encyclopedia-mobile-controls")}>
        <SearchBar
          autoFocus={autoFocusSearch}
          query={query}
          onChange={onQueryChange}
          t={t}
        />
        <CategoryDropdown
          availableCategories={availableMobileCategories}
          customFilters={customFilters ?? []}
          isOpen={categoryMenuOpen}
          onChange={onMobileSelectedCategoriesChange}
          onClose={() => setCategoryMenuOpen(false)}
          onCustomFilterChange={onSelectedCustomFilterChange}
          onToggle={() => setCategoryMenuOpen((value) => !value)}
          selectedCategories={mobileSelectedCategories}
          selectedCustomFilterIndex={selectedCustomFilterIndex}
          t={t}
        />
      </div>
      <main className={cm(styles, "encyclopedia-main")}>
        <RecentItemsRow
          items={recentFilteredItems}
          index={index}
          onItemClick={onItemClick}
          t={t}
        />
        <CardGrid
          items={filteredItems}
          entities={filteredEntities}
          index={index}
          onItemClick={onItemClick}
          onEntityClick={onEntityClick}
          t={t}
        />
      </main>
    </div>
  );
}
