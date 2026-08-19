export const REGIONAL_SIMULATION_SPEEDS = [0.25, 1, 2] as const;

const REGIONAL_SIMULATION_SPEED_SET: ReadonlySet<number> = new Set(
  REGIONAL_SIMULATION_SPEEDS,
);

export function isRegionalSimulationSpeed(value: number): boolean {
  return REGIONAL_SIMULATION_SPEED_SET.has(value);
}
