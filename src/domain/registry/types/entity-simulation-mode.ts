import type { SimulationMode } from "../../shared/simulation-mode";
import type { EntityInspectorDeclaration } from "./entity-inspector";

/** 设备随仿真模式切换的运行行为类型。 */
export const ENTITY_SIMULATION_BEHAVIOR_TYPE = {
  inputRouting: "input-routing",
} as const;

export type EntitySimulationBehaviorType =
  typeof ENTITY_SIMULATION_BEHAVIOR_TYPE[keyof typeof ENTITY_SIMULATION_BEHAVIOR_TYPE];

/** 输入缓存的模式化路由策略。 */
export const ENTITY_INPUT_ROUTING_STRATEGY = {
  localStorage: "local-storage",
  warehouseSinkWhenUnlinked: "warehouse-sink-when-unlinked",
} as const;

export type EntityInputRoutingStrategy =
  typeof ENTITY_INPUT_ROUTING_STRATEGY[keyof typeof ENTITY_INPUT_ROUTING_STRATEGY];

export interface EntityInputRoutingSimulationBehaviorDeclaration {
  readonly type: typeof ENTITY_SIMULATION_BEHAVIOR_TYPE.inputRouting;
  readonly strategy: EntityInputRoutingStrategy;
  readonly storageSlotGroupIds: readonly string[];
}

export type EntitySimulationBehaviorDeclaration =
  EntityInputRoutingSimulationBehaviorDeclaration;

/** Registry 中某个设备在指定仿真模式下的静态配置。 */
export interface EntitySimulationModeConfig {
  readonly behaviors: readonly EntitySimulationBehaviorDeclaration[];
  /** 省略时沿用 EntityDefinition.inspectors。 */
  readonly inspectors?: readonly EntityInspectorDeclaration[];
}

export type EntitySimulationModeConfigMap = Readonly<
  Partial<Record<SimulationMode, EntitySimulationModeConfig>>
>;
