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
  /** 配方运行/启动所需气体扩散范围。值为气体物品 ID。 */
  requiredGasDiffusion?: string;
  /** 配方运行期间提供的气体扩散范围。仅供气体扩散设备配方使用。 */
  gasDiffusionOutput?: {
    readonly gasItemId: string;
    readonly range: number;
  };
  /** 主要产物物品 ID 列表。与 outputs 可以不同，用于仿真运行时的设备图标替换。 */
  primaryOutputs?: string[];
}
