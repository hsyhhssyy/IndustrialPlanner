
export type RecipeType = "immediate-consume" | "reserved-item";

export interface RecipeDefinition {
  id: string;
  nameKey: string;
  durationSeconds: number;
  inputs: Array<{ itemId: string; amount: number }>;
  outputs: Array<{ itemId: string; amount: number }>;
  machineId: string;
  recipeType: RecipeType;
  tags: string[];
}