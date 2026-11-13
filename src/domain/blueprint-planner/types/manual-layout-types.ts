import type { GridPoint, GridRotation } from "../../shared/grid";
import type { BlueprintPlannerFlow } from "./blueprint-planner-types";

export type BlueprintPlannerManualBindingMode = "device" | "recipe" | "topology";
export type BlueprintPlannerManualOrientation = "free" | "fixed";
export type BlueprintPlannerManualBoundarySide = "base" | "left" | "right";

export interface BlueprintPlannerManualBoundaryAssignment {
  readonly referenceNode: BlueprintPlannerManualNode;
  readonly side: BlueprintPlannerManualBoundarySide;
}

export interface BlueprintPlannerManualBoundaryLayout {
  readonly rotation: GridRotation | null;
  readonly assignments: readonly BlueprintPlannerManualBoundaryAssignment[];
}

/** 草稿格点到候选／交付格点的整体旋转和平移。 */
export interface BlueprintPlannerManualTransform {
  readonly rotation: GridRotation;
  readonly translation: GridPoint;
}

export interface BlueprintPlannerManualNode {
  readonly id: string;
  readonly definitionId: string;
  readonly recipeId: string | null;
  readonly purpose: "production" | "environment" | "auxiliary" | "supply" | "product" | "byproduct" | "startup" | "power";
  readonly inputs: readonly BlueprintPlannerFlow[];
  readonly outputs: readonly BlueprintPlannerFlow[];
}

export interface BlueprintPlannerManualFacilityTemplate {
  readonly definitionId: string;
  readonly recipeId: string | null;
  readonly purpose: "environment" | "power";
}

export interface BlueprintPlannerManualFacility extends BlueprintPlannerManualFacilityTemplate {
  readonly id: string;
}

export interface BlueprintPlannerManualConnection {
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly itemId: string;
  readonly perMinute: number;
}

export type BlueprintPlannerManualPlacementIssue =
  | { readonly kind: "excess"; readonly nodeIds: readonly string[]; readonly excessCount: number }
  | { readonly kind: "role-removed" | "incompatible" | "boundary-side-unavailable"; readonly nodeIds: readonly string[] };

export interface BlueprintPlannerManualPreparation {
  readonly sourceKey: string;
  readonly nodes: readonly BlueprintPlannerManualNode[];
  readonly connections: readonly BlueprintPlannerManualConnection[];
  readonly facilityTemplates: readonly BlueprintPlannerManualFacilityTemplate[];
  readonly placementIssues: readonly BlueprintPlannerManualPlacementIssue[];
}

export interface BlueprintPlannerManualPlacement {
  /** 编辑引用快照；职责失效后仍可显示，不能加入有效网络反算需求。 */
  readonly referenceNode: BlueprintPlannerManualNode;
  readonly position: GridPoint;
  readonly rotation: GridRotation;
}

export interface BlueprintPlannerManualLayout {
  readonly enabled: boolean;
  readonly mode: BlueprintPlannerManualBindingMode;
  readonly orientation: BlueprintPlannerManualOrientation;
  readonly boundary: BlueprintPlannerManualBoundaryLayout;
  readonly preparation: BlueprintPlannerManualPreparation;
  readonly placements: readonly BlueprintPlannerManualPlacement[];
  readonly facilities: readonly BlueprintPlannerManualFacility[];
}
