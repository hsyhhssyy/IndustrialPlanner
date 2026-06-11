import { makeAutoObservable } from "mobx";

import type { DialogStateReadWrite } from "@/app/state/state-impl";
import type {
  ToolboxWikiDesktopCategory,
  ToolboxWikiMobileFilterOption,
} from "@/app/toolbox-types";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { ItemDefinition } from "@/domain/registry/types/item-definition";

export type EncyclopediaPickerSelectionKind = "item" | "entity";

export interface EncyclopediaPickerSelection {
  kind: EncyclopediaPickerSelectionKind;
  id: string;
}

export interface EncyclopediaPickerRequest {
  title?: string;
  initialQuery?: string;
  kinds?: readonly EncyclopediaPickerSelectionKind[];
  filterItem?: (item: ItemDefinition) => boolean;
  filterEntity?: (entity: EntityDefinition) => boolean;
  includeInactiveActivityItems?: boolean;
  initialDesktopCategory?: ToolboxWikiDesktopCategory;
  initialMobileSelectedCategories?: readonly ToolboxWikiMobileFilterOption[];
}

const DEFAULT_PICKER_KINDS: EncyclopediaPickerSelectionKind[] = ["item"];

export interface EncyclopediaPickerSharedFilterState {
  desktopCategory: ToolboxWikiDesktopCategory;
  mobileSelectedCategories: ToolboxWikiMobileFilterOption[];
}

function createDefaultDialogState(): DialogStateReadWrite {
  return {
    visible: false,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: null,
    height: null,
    activeTab: null,
  };
}

function normalizeKinds(
  kinds: readonly EncyclopediaPickerSelectionKind[] | undefined,
): EncyclopediaPickerSelectionKind[] {
  if (kinds === undefined || kinds.length === 0) {
    return [...DEFAULT_PICKER_KINDS];
  }

  const normalized = new Set<EncyclopediaPickerSelectionKind>();
  for (const kind of kinds) {
    if (kind === "item" || kind === "entity") {
      normalized.add(kind);
    }
  }

  return normalized.size > 0 ? Array.from(normalized) : [...DEFAULT_PICKER_KINDS];
}

export class WorkbenchEncyclopediaPickerController {
  dialogState: DialogStateReadWrite = createDefaultDialogState();
  title: string | null = null;
  query = "";
  allowedKinds: EncyclopediaPickerSelectionKind[] = [...DEFAULT_PICKER_KINDS];
  includeInactiveActivityItems = false;
  recentItemIds: string[] = [];

  _resolveSharedFilterState: () => EncyclopediaPickerSharedFilterState;
  _itemFilter: ((item: ItemDefinition) => boolean) | undefined;
  _entityFilter: ((entity: EntityDefinition) => boolean) | undefined;
  _resolver: ((selection: EncyclopediaPickerSelection | null) => void) | null = null;

  public constructor(resolveSharedFilterState: () => EncyclopediaPickerSharedFilterState) {
    this._resolveSharedFilterState = resolveSharedFilterState;

    try {
      const raw = localStorage.getItem("planner.recent-picker-items");
      if (raw !== null) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.recentItemIds = parsed
            .filter((v): v is string => typeof v === "string")
            .slice(0, 20);
        }
      }
    } catch {
      // Storage 不可用或数据损坏时，保持空列表
    }

    try {
      const raw = localStorage.getItem("planner.last-picker-query");
      if (raw !== null) {
        this.query = raw;
      }
    } catch {
      // Storage 不可用时保持空字符串
    }

    makeAutoObservable(this, {
      _resolveSharedFilterState: false,
      _entityFilter: false,
      _itemFilter: false,
      _resolver: false,
    }, { autoBind: true });
  }

  public get desktopCategory(): ToolboxWikiDesktopCategory {
    return this._resolveSharedFilterState().desktopCategory;
  }

  public get mobileSelectedCategories(): ToolboxWikiMobileFilterOption[] {
    return this._resolveSharedFilterState().mobileSelectedCategories;
  }

  public setQuery(query: string) {
    this.query = query;
  }

  public setDesktopCategory(category: ToolboxWikiDesktopCategory) {
    this._resolveSharedFilterState().desktopCategory = category;
  }

  public setMobileSelectedCategories(categories: ToolboxWikiMobileFilterOption[]) {
    this._resolveSharedFilterState().mobileSelectedCategories = [...categories];
  }

  public setOffset(offsetX: number, offsetY: number) {
    if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) {
      return;
    }

    this.dialogState.offsetX = Math.round(offsetX);
    this.dialogState.offsetY = Math.round(offsetY);
  }

  public setSize(width: number | null, height: number | null) {
    if (width !== null && (!Number.isFinite(width) || width <= 0)) {
      return;
    }

    if (height !== null && (!Number.isFinite(height) || height <= 0)) {
      return;
    }

    this.dialogState.width = width === null ? null : Math.round(width);
    this.dialogState.height = height === null ? null : Math.round(height);
  }

  public toggleMaximized() {
    this.dialogState.maximized = !this.dialogState.maximized;
  }

  public matchesItem(item: ItemDefinition): boolean {
    return this.allowedKinds.includes("item")
      && (this._itemFilter?.(item) ?? true);
  }

  public matchesEntity(entity: EntityDefinition): boolean {
    return this.allowedKinds.includes("entity")
      && (this._entityFilter?.(entity) ?? true);
  }

  public async pickItem(options: Omit<EncyclopediaPickerRequest, "filterEntity" | "initialDesktopCategory" | "kinds"> = {}): Promise<string | null> {
    const selection = await this.pickEntry({
      ...options,
      kinds: ["item"],
    });

    return selection?.kind === "item" ? selection.id : null;
  }

  public async pickEntity(options: Omit<EncyclopediaPickerRequest, "filterItem" | "initialDesktopCategory" | "kinds"> = {}): Promise<string | null> {
    const selection = await this.pickEntry({
      ...options,
      kinds: ["entity"],
    });

    return selection?.kind === "entity" ? selection.id : null;
  }

  public pickEntry(request: EncyclopediaPickerRequest = {}): Promise<EncyclopediaPickerSelection | null> {
    this.finish(null);

    const nextKinds = normalizeKinds(request.kinds);
    this.allowedKinds = nextKinds;
    this.title = request.title ?? null;
    this.query = request.initialQuery ?? this.query;
    if (request.initialDesktopCategory !== undefined) {
      this.setDesktopCategory(request.initialDesktopCategory);
    }
    if (request.initialMobileSelectedCategories !== undefined) {
      this.setMobileSelectedCategories([...request.initialMobileSelectedCategories]);
    }
    this._itemFilter = request.filterItem;
    this._entityFilter = request.filterEntity;
    this.includeInactiveActivityItems = request.includeInactiveActivityItems === true;
    this.dialogState.visible = true;

    return new Promise((resolve) => {
      this._resolver = resolve;
    });
  }

  public selectItem(id: string) {
    this.recordRecentItem(id);
    this.finish({ kind: "item", id });
  }

  public selectEntity(id: string) {
    this.finish({ kind: "entity", id });
  }

  public cancel() {
    this.finish(null);
  }

  public dispose() {
    this.finish(null);
  }

  private recordRecentItem(id: string) {
    const next = this.recentItemIds.filter((rid) => rid !== id);
    next.unshift(id);
    this.recentItemIds = next.slice(0, 20);

    try {
      localStorage.setItem("planner.recent-picker-items", JSON.stringify(this.recentItemIds));
    } catch {
      // Storage 不可用时静默失败
    }
  }

  private finish(selection: EncyclopediaPickerSelection | null) {
    const resolver = this._resolver;
    this._resolver = null;
    this.dialogState.visible = false;
    this._itemFilter = undefined;
    this._entityFilter = undefined;
    this.includeInactiveActivityItems = false;

    try {
      localStorage.setItem("planner.last-picker-query", this.query);
    } catch {
      // Storage 不可用时静默失败
    }

    resolver?.(selection);
  }
}
