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
  /** 配方运行时发电量（kW），默认 0。仅供发电设备配方使用。 */
  powerOutput?: number;
}
