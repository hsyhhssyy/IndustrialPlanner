// =========================================================================
// Placement Behavior 声明
//
// PlacementBehavior 与 Inspector 类似：EntityDefinition 只声明行为类型，
// 具体校验由 editor owner 实现。声明本身不持有运行态数据。
// =========================================================================

export const PLACEMENT_BEHAVIOR_TYPE = {
  defaultPlacement: "default-placement",
  allowPipeOverlap: "allow-pipe-overlap",
  mustConnectToHub: "must-connect-to-hub",
  mustConnectToHubViaOppositePortEdge: "must-connect-to-hub-via-opposite-port-edge",
  cannotBePlacedOutsideBase: "cannot-be-placed-outside-base",
} as const;

export type PlacementBehaviorType =
  typeof PLACEMENT_BEHAVIOR_TYPE[keyof typeof PLACEMENT_BEHAVIOR_TYPE];

export type EntityPlacementBehaviorDeclaration =
  | { readonly type: typeof PLACEMENT_BEHAVIOR_TYPE.defaultPlacement }
  | { readonly type: typeof PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap }
  | { readonly type: typeof PLACEMENT_BEHAVIOR_TYPE.mustConnectToHub }
  | { readonly type: typeof PLACEMENT_BEHAVIOR_TYPE.mustConnectToHubViaOppositePortEdge }
  | { readonly type: typeof PLACEMENT_BEHAVIOR_TYPE.cannotBePlacedOutsideBase };
