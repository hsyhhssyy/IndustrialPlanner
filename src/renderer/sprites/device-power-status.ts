// AI-REMOVED 2026-10-13:
// Reason: Renderer 不应拥有设备身份和定时上传的领域规则。
// Trigger: 用户确认将特殊判定集中到 RegistryQuery.isPowerWarningEnabled。
// Evidence: 现有 Registry Query 已承载设备分类与特殊默认端口优先级，适合复用相同边界。
// Replacement: src/registry/registry-query.ts 的 isPowerWarningEnabled；供电范围判断保留在 GenericDeviceSprite。
// Risk: Low - 原有显示条件保留，未知设备定义不启用提示。
// Human Review: Required
//
// Original code:
// import type { WorldEntity } from "@/domain/document/world-document";
// import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
//
// /** 断电提示只表示供电覆盖缺失，不依赖仿真状态或基地总电量。 */
// export function shouldShowPowerDisconnectedIcon(options: {
//   definition: Pick<EntityDefinition, "id" | "powerDemand">;
//   config: WorldEntity["config"];
//   isInPowerRange: boolean;
// }): boolean {
//   if (options.definition.powerDemand <= 0 || options.isInPowerRange) {
//     return false;
//   }
//
//   // 协议储存箱仅在定时上传开启时提示断电；普通收发与储存不触发提示。
//   if (options.definition.id === "storager_1") {
//     const channelRecipes = options.config.channelRecipes;
//     return channelRecipes !== null
//       && typeof channelRecipes === "object"
//       && "warehouse_submit" in channelRecipes
//       && channelRecipes.warehouse_submit === "r_warehouse_submit";
//   }
//
//   return true;
// }
