// =========================================================================
// Placement Behavior 声明
//
// PlacementBehavior 与 Inspector 类似：EntityDefinition 只声明行为类型，
// 具体校验由 editor owner 实现。声明本身不持有运行态数据。
// =========================================================================

export const PLACEMENT_BEHAVIOR_TYPE = {
  defaultPlacement: "default-placement",
  allowPipeOverlap: "allow-pipe-overlap",
  allowBeltOverlap: "allow-belt-overlap",
  mustConnectToHub: "must-connect-to-hub",
  mustConnectToHubViaOppositePortEdge: "must-connect-to-hub-via-opposite-port-edge",
  cannotBePlacedOutsideBase: "cannot-be-placed-outside-base",
  snapToOuterRingEdge: "snap-to-outer-ring-edge",
  rotateToSnapOnBuilding: "rotate-to-snap-on-building",
  noNearSameEntity: "no-near-same-entity",
} as const;

export type PlacementBehaviorType =
  typeof PLACEMENT_BEHAVIOR_TYPE[keyof typeof PLACEMENT_BEHAVIOR_TYPE];

export type EntityPlacementBehaviorDeclaration =
  | { readonly type: typeof PLACEMENT_BEHAVIOR_TYPE.defaultPlacement }
  | { readonly type: typeof PLACEMENT_BEHAVIOR_TYPE.allowPipeOverlap }
  | { readonly type: typeof PLACEMENT_BEHAVIOR_TYPE.allowBeltOverlap }
  | { readonly type: typeof PLACEMENT_BEHAVIOR_TYPE.mustConnectToHub }
  | { readonly type: typeof PLACEMENT_BEHAVIOR_TYPE.mustConnectToHubViaOppositePortEdge }
  | { readonly type: typeof PLACEMENT_BEHAVIOR_TYPE.cannotBePlacedOutsideBase }
  | { readonly type: typeof PLACEMENT_BEHAVIOR_TYPE.snapToOuterRingEdge }
  | {
    readonly type: typeof PLACEMENT_BEHAVIOR_TYPE.rotateToSnapOnBuilding;
    readonly targetDeviceIds: readonly string[];
  }
  | { readonly type: typeof PLACEMENT_BEHAVIOR_TYPE.noNearSameEntity; readonly range: number };
