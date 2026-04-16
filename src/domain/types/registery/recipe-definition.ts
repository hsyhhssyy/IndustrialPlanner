export interface RecipeDefinition {
  id: string;
  nameKey: string;
  name: string;
  durationSeconds: number;
  inputs: Array<{ itemId: string; amount: number }>;
  outputs: Array<{ itemId: string; amount: number }>;
}