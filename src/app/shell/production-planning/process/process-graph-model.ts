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
  readonly iconSrc: string;
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
