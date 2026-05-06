import type { GridPoint, GridRotation } from "../types/grid";

export interface SimulationReservedItemReadModel {
  readonly recipeRunId: string;
  readonly itemType: string;
  readonly amount: number;
}

export interface SimulationDeviceRuntimeSlotItemReadModel {
  readonly storageGroupId: string | null;
  readonly slotId: string;
  readonly itemType: string | null;
  readonly count: number;
  readonly reserved: readonly SimulationReservedItemReadModel[];
}

export interface SimulationDeviceRuntimeReadModel {
  readonly recipeId: string | null;
  readonly progressSeconds: number | null;
  readonly desiredSeconds: number | null;
  readonly slotItems: readonly SimulationDeviceRuntimeSlotItemReadModel[];
}

export type SimulationBeltCargoShape = "straight" | "turn-cw" | "turn-ccw";

export interface SimulationBeltCargoReadModel {
  readonly beltShape: SimulationBeltCargoShape;
  readonly position: GridPoint;
  readonly rotation: GridRotation;
  readonly itemId: string;
  readonly progress: number;
}

export interface SimulationCurrentTickRecipeReadModel {
  readonly runId: string;
  readonly recipeId: string;
  readonly recipeType: string;
  readonly progressTicks: number;
  readonly durationTicks: number;
  readonly state: "running" | "waiting-output" | "idle";
}

export interface SimulationCurrentTickDeviceReadModel {
  readonly deviceId: string;
  readonly block: boolean;
  readonly recipe: SimulationCurrentTickRecipeReadModel | null;
}

export interface SimulationCurrentTickSlotReadModel {
  readonly slotId: string;
  readonly itemType: string | null;
  readonly count: number;
  readonly reserved: readonly SimulationReservedItemReadModel[];
}

export interface SimulationCurrentTickNodeReadModel {
  readonly cacheGroupId: string;
  readonly nodeId: string;
  readonly result: "uncertain" | "solved-run" | "solved-block";
  readonly acceptedInputEdgeIds: readonly string[];
  readonly acceptedOutputEdgeIds: readonly string[];
  readonly blockReason?: string;
}

export interface SimulationCurrentTickTransferReadModel {
  readonly edgeId: string;
  readonly sourceSlotId: string;
  readonly targetSlotId: string;
  readonly itemType: string;
  readonly amount: number;
}

export interface SimulationCurrentTickDiagnosticReadModel {
  readonly severity: "info" | "warning" | "error";
  readonly code: string;
  readonly message: string;
}

export interface SimulationCurrentTickReadModel {
  readonly topologyId: string;
  readonly documentHash: string;
  readonly tickNumber: number;
  readonly status: "initial" | "running" | "paused" | "stopped";
  readonly slots: Readonly<Record<string, SimulationCurrentTickSlotReadModel>>;
  readonly devices: Readonly<Record<string, SimulationCurrentTickDeviceReadModel>>;
  readonly nodes: Readonly<Record<string, SimulationCurrentTickNodeReadModel>>;
  readonly transfers: readonly SimulationCurrentTickTransferReadModel[];
  readonly routingCursors: Readonly<Record<string, number>>;
  readonly warehouse: Readonly<Record<string, number>>;
  readonly diagnostics: readonly SimulationCurrentTickDiagnosticReadModel[];
}