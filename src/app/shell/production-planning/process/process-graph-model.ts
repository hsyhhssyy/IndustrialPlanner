import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";

export type ProcessNodeType =
  | "target"
  | "main"
  | "secondary"
  | "natural"
  | "cycle"
  | "device";

export interface ProcessNode {
  readonly itemId: string;
  readonly col: number;
  readonly row: number;
  readonly type: ProcessNodeType;
  // AI-REMOVED 2026-09-01:
  // Reason: 模块图标已由单个资源升级为 1～4 个物品图标的组合布局。
  // Trigger: 模块编辑、模块配平与产线规划统一显示组合图标的需求。
  // Evidence: ProductionPlanningModuleSnapshot.iconItemIds 是模块图标的唯一数据源。
  // Replacement: ProcessNode.iconSrcs
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // readonly iconSrc: string;
  readonly iconSrcs: readonly string[];
  readonly name: string;
  readonly candidateId?: string;
  readonly recipeId?: string;
  readonly amount?: number;
  /** 该节点是否是可见行（null = 可见的展开符号/物品节点，否则=已展开） */
  readonly expandedRecipeId: string | null;
}

export interface ProcessLink {
  readonly fromCol: number;
  readonly fromRow: number;
  readonly toCol: number;
  readonly toRow: number;
  /** 在 fromCol 和 toCol 之间的列边界 x 坐标 (SVG 域) */
  readonly boundaryCol: number;
}

export interface ProcessGraph {
  readonly nodes: readonly ProcessNode[];
  readonly links: readonly ProcessLink[];
  readonly maxCol: number;
  readonly maxRow: number;
}

export interface ProcessBuildContext {
  readonly index: ProcessBuildIndex;
  readonly recipeChoices: ReadonlyMap<string, string>;
  readonly expandedItemIds: ReadonlySet<string>;
  readonly naturalResourceItemIds: ReadonlySet<string>;
  readonly recipeById: ReadonlyMap<string, RecipeDefinition>;
}

export interface ProcessBuildIndex {
  readonly resolveItemIconSrc: (itemId: string) => string;
  readonly resolveItemName: (itemId: string) => string;
}
