import type { PlannerSearchProfile } from "./search-profile";
import type { WorldEntity } from "@/domain/document/world-document";
import type { PlannerWire } from "./model";

/** 搜索控制属于规划器内部；生产界面仍使用 Domain 的时间预算。 */
export interface PlannerSearchOptions {
  readonly maxEvaluations?: number;
  readonly outline?: { readonly width: number; readonly height: number };
  readonly profile?: Partial<PlannerSearchProfile>;
}

export interface PlannerSearchStatistics {
  readonly seed: number;
  readonly evaluationLimit: number;
  readonly outline: { readonly width: number; readonly height: number };
  evaluations: number;
  acceptedMoves: number;
  routingAttempts: number;
  wireCount?: number;
  bestRoutedWireCount?: number;
  initialWireLength: number;
  finalWireLength: number;
  readonly profile?: PlannerSearchProfile;
  layoutSnapshot?: readonly WorldEntity[];
  routeSnapshot?: readonly WorldEntity[];
  blockedWire?: PlannerWire;
  quality?: { readonly secondary: number; readonly occupiedCells: number; readonly utilization: number;
    readonly excessFluidSources: number; readonly lengthPenalty: number; readonly turnPenalty: number; readonly adjacencyPairs: number };
  remainingConflicts?: { readonly geometry: number; readonly power: number; readonly boundary: number; readonly connections: number };
}
