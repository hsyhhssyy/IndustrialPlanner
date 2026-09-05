export const STANDARD_TICK_RATE_PER_SECOND = 20
export const DENSE_STANDARD_TICK_RATE_PER_SECOND = 2
export const RECIPE_PHASE_DURATION_SECONDS = 0.5
export const DEFAULT_SIMULATION_SPEED = 1
export const DYNAMIC_SIMULATION_TICK_RATES = [20, 10, 4, 2] as const

export type DynamicSimulationTickRate = typeof DYNAMIC_SIMULATION_TICK_RATES[number]

// 除 add time 使用 simulationSpeed 外，所有 tick <-> second 换算都必须走 standard tick rate。
export function convertSimulationTicksToSeconds(
	tickCount: number,
	standardTickRate = STANDARD_TICK_RATE_PER_SECOND,
): number {
	return tickCount / standardTickRate
}

export function convertSimulationSecondsToTicksExact(
	durationSeconds: number,
	standardTickRate: number,
): number | null {
	if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
		return null
	}
	const durationTicks = durationSeconds * standardTickRate
	return Number.isSafeInteger(durationTicks) && durationTicks > 0
		? durationTicks
		: null
}

export function resolveRecipePhaseTicks(standardTickRate: number): number | null {
	return convertSimulationSecondsToTicksExact(
		RECIPE_PHASE_DURATION_SECONDS,
		standardTickRate,
	)
}

export function resolveStandardStepTicks(
	dynamicTickRate: number,
	standardTickRate = STANDARD_TICK_RATE_PER_SECOND,
): number | null {
	if (!Number.isFinite(dynamicTickRate) || dynamicTickRate <= 0) {
		return null
	}

	const standardStepTicks = standardTickRate / dynamicTickRate
	if (!Number.isInteger(standardStepTicks) || standardStepTicks <= 0) {
		return null
	}

	return standardStepTicks
}

export function isDynamicTickRateCompatibleWithTransferUnits(options: {
	readonly dynamicTickRate: number
	readonly transferUnitTicks: readonly number[]
	readonly standardTickRate?: number
}): boolean {
	const standardStepTicks = resolveStandardStepTicks(
		options.dynamicTickRate,
		options.standardTickRate,
	)
	if (standardStepTicks === null) {
		return false
	}

	return options.transferUnitTicks.every((transferUnitTicks) =>
		transferUnitTicks > 0 && transferUnitTicks % standardStepTicks === 0
	)
}

export function resolveNextLowerDynamicTickRate(
	currentDynamicTickRate: number,
	legalDynamicTickRates: readonly number[],
): number {
	const sortedRates = sortDynamicTickRates(legalDynamicTickRates)
	if (sortedRates.length === 0) {
		return currentDynamicTickRate
	}

	const currentIndex = sortedRates.indexOf(currentDynamicTickRate)
	if (currentIndex === -1) {
		return sortedRates[0] ?? currentDynamicTickRate
	}

	return sortedRates[Math.min(sortedRates.length - 1, currentIndex + 1)] ?? currentDynamicTickRate
}

export function resolveNextHigherDynamicTickRate(
	currentDynamicTickRate: number,
	legalDynamicTickRates: readonly number[],
): number {
	const sortedRates = sortDynamicTickRates(legalDynamicTickRates)
	if (sortedRates.length === 0) {
		return currentDynamicTickRate
	}

	const currentIndex = sortedRates.indexOf(currentDynamicTickRate)
	if (currentIndex === -1) {
		return sortedRates[0] ?? currentDynamicTickRate
	}

	return sortedRates[Math.max(0, currentIndex - 1)] ?? currentDynamicTickRate
}

export function sortDynamicTickRates(
	dynamicTickRates: readonly number[],
): number[] {
	return [...new Set(dynamicTickRates)]
		.filter((rate) => Number.isFinite(rate) && rate > 0)
		.sort((left, right) => right - left)
}
