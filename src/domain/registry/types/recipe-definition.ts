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
  /** AI-CORRECTION 2026-10-14: 环境条件支持任意一种物品环境，包含灌溉液体和气体。 */
  requiredEnvironmentAnyOf?: readonly string[];
  /** 配方运行期间提供的气体扩散范围。仅供气体扩散设备配方使用。 */
  /** AI-CORRECTION 2026-10-14: 统一提供液体或气体环境，普通频道随电力暂停，消耗频道保持原有运行规则。 */
  environmentOutput?: {
    readonly itemId: string;
    // AI-REMOVED 2026-10-13:
    // Reason: 几何声明归属设备，配方只引用范围。
    // Trigger: 统一设备范围机制。
    // Evidence: 四种气体配方重复声明同一边长。
    // Replacement: rangeId 对应 EntityDefinition.ranges[].id。
    // Risk: 所有范围读取点同步迁移。
    // Human Review: Required
    // Original code:
    // readonly range: number;
    readonly rangeId: string;
  };
  /** 产物提交目标；省略时写入设备的产物缓存。 */
  outputTarget?: "device" | "warehouse";
  /** 主要产物物品 ID 列表。与 outputs 可以不同，用于仿真运行时的设备图标替换。 */
  primaryOutputs?: string[];
}
