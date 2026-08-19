// AI-REMOVED 2026-08-19:
// Reason: Registry 不再声明或解析任何随 SimulationMode 变化的设备覆盖配置。
// Trigger: 用户要求暂时删除 simulationModeConfigs 及全部 Registry mode override 基础设施。
// Evidence: 当前没有设备存在真实模式差异；公共行为已统一由 EntityDefinition.simulationBehaviors 声明。
// Replacement: entity-simulation-behavior.ts 保存与模式无关的基础行为类型。
// Risk: Medium - 未来若重新引入设备模式差异，必须重新设计而不能恢复该历史接口。
// Human Review: Required
//
// Original code:
// import type { SimulationMode } from "../../shared/simulation-mode";
// import type { EntityInspectorDeclaration } from "./entity-inspector";
//
// /** 设备随仿真模式切换的运行行为类型。 */
// export const ENTITY_SIMULATION_BEHAVIOR_TYPE = {
//   inputRouting: "input-routing",
// } as const;
//
// export type EntitySimulationBehaviorType =
//   typeof ENTITY_SIMULATION_BEHAVIOR_TYPE[keyof typeof ENTITY_SIMULATION_BEHAVIOR_TYPE];
//
// /** 输入缓存的模式化路由策略。 */
// export const ENTITY_INPUT_ROUTING_STRATEGY = {
//   localStorage: "local-storage",
//   warehouseSinkWhenUnlinked: "warehouse-sink-when-unlinked",
// } as const;
//
// export type EntityInputRoutingStrategy =
//   typeof ENTITY_INPUT_ROUTING_STRATEGY[keyof typeof ENTITY_INPUT_ROUTING_STRATEGY];
//
// export interface EntityInputRoutingSimulationBehaviorDeclaration {
//   readonly type: typeof ENTITY_SIMULATION_BEHAVIOR_TYPE.inputRouting;
//   readonly strategy: EntityInputRoutingStrategy;
//   readonly storageSlotGroupIds: readonly string[];
// }
//
// export type EntitySimulationBehaviorDeclaration =
//   EntityInputRoutingSimulationBehaviorDeclaration;
//
// /** Registry 中某个设备在指定仿真模式下的静态配置。 */
// export interface EntitySimulationModeConfig {
//   /** 省略时沿用 EntityDefinition.simulationBehaviors。 */
//   readonly behaviors?: readonly EntitySimulationBehaviorDeclaration[];
//   /** 省略时沿用 EntityDefinition.inspectors。 */
//   readonly inspectors?: readonly EntityInspectorDeclaration[];
// }
//
// export type EntitySimulationModeConfigMap = Readonly<
//   Partial<Record<SimulationMode, EntitySimulationModeConfig>>
// >;
