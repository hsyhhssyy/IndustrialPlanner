/**
 * Toolbox（工具箱 / 百科 / 模块平衡器）相关的 UI 状态类型。
 *
 * 这些类型原本定义在 domain/app/types/app-types.ts，但它们本质是 App UI 层概念，
 * 不涉及 domain 层 contract，故搬迁至此。
 *
 * AI-CORRECTION 2026-05-28: 从 domain/app/types/app-types.ts 搬迁到 src/app/toolbox-types.ts，
 *   以消除 domain/app → domain/registry 的跨子模块引用违规。
 */

import type { UiGroup } from "@/domain/registry/types/entity-definition";

// ── ToolboxWiki（百科浏览器） ────────────────────────

export type ToolboxWikiNavigationEntryType = "item" | "entity";
export type ToolboxWikiEntityGroupCategory = Exclude<UiGroup, "hidden">;
export type ToolboxWikiDesktopCategory =
  | "all"
  | "item"
  | "entity"
  | ToolboxWikiEntityGroupCategory;
export type ToolboxWikiMobileCategory = Exclude<ToolboxWikiDesktopCategory, "all">;
export type ToolboxWikiMobileFilterOption =
  | ToolboxWikiMobileCategory
  | "excludeBottledLiquid";

export interface ToolboxWikiNavigationEntry {
  readonly type: ToolboxWikiNavigationEntryType;
  readonly id: string;
}

export type ToolboxWikiOpenedPage =
  | { readonly kind: "browser" }
  | { readonly kind: "item"; readonly id: string }
  | { readonly kind: "entity"; readonly id: string };

export interface ToolboxWikiState {
  readonly searchQuery: string;
  readonly desktopCategory: ToolboxWikiDesktopCategory;
  readonly mobileSelectedCategories: readonly ToolboxWikiMobileFilterOption[];
  readonly navigationStack: readonly ToolboxWikiNavigationEntry[];
  readonly openedPage: ToolboxWikiOpenedPage;
}

// ── ModuleBalancing（模块平衡器） ──────────────────────

export interface ModuleBalancingIOPort {
  readonly itemId: string;
  readonly perMinute: number;
}

export interface ModuleBalancingCustomModule {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly iconId: string;
  readonly notes: string;
  readonly inputs: readonly ModuleBalancingIOPort[];
  readonly outputs: readonly ModuleBalancingIOPort[];
  readonly sourceType: "custom";
}

export interface ModuleBalancingSystemRecipeModule {
  readonly id: string;
  readonly sourceType: "system-recipe";
  readonly recipeId: string;
}

export type ModuleBalancingModule =
  | ModuleBalancingCustomModule
  | ModuleBalancingSystemRecipeModule;

export interface ModuleBalancingStageModuleEntry {
  readonly moduleId: string;
  readonly quantity: number;
}

export interface ModuleBalancingStage {
  readonly id: string;
  readonly name: string;
  readonly entries: readonly ModuleBalancingStageModuleEntry[];
}

export interface ModuleBalancingCanvas {
  readonly id: string;
  readonly name: string;
  readonly globalInputs: readonly ModuleBalancingIOPort[];
  readonly stages: readonly ModuleBalancingStage[];
  readonly warehouseCapacity: number | null;
}

export interface ModuleBalancingState {
  readonly canvases: readonly ModuleBalancingCanvas[];
  readonly customModules: readonly ModuleBalancingCustomModule[];
  readonly activeCanvasId: string | null;
}

// ── ToolboxState（聚合） ──────────────────────────────

export interface ToolboxState {
  readonly wiki: ToolboxWikiState;
  readonly moduleBalancing: ModuleBalancingState;
}
