export const STANDARD_TICK_RATE_PER_SECOND = 20
export const DEFAULT_SIMULATION_SPEED = 1

// 除 add time 使用 simulationSpeed 外，所有 tick <-> second 换算都必须走 standard tick rate。
export function convertSimulationTicksToSeconds(tickCount: number): number {
	return tickCount / STANDARD_TICK_RATE_PER_SECOND
}