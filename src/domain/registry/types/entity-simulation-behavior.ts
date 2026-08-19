/** 设备静态运行行为类型。 */
export const ENTITY_SIMULATION_BEHAVIOR_TYPE = {
  inputRouting: "input-routing",
} as const;

export type EntitySimulationBehaviorType =
  typeof ENTITY_SIMULATION_BEHAVIOR_TYPE[keyof typeof ENTITY_SIMULATION_BEHAVIOR_TYPE];

/** 输入缓存路由策略。 */
export const ENTITY_INPUT_ROUTING_STRATEGY = {
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
