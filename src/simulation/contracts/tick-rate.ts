export const STANDARD_TICK_RATE_PER_SECOND = 20
export const DENSE_STANDARD_TICK_RATE_PER_SECOND = 4
export const DENSE_LOW_STANDARD_TICK_RATE_PER_SECOND = 2
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

/**
 * 在以 tick 1 为共同业务相位原点的两套标准频率之间换算 tick 坐标。
 * 历史时间戳允许落在目标频率的两个真实 tick 之间，因此返回值可以是小数。
 */
export function convertSimulationPhaseTickBetweenRates(
	tickNumber: number,
	previousStandardTickRate: number,
	nextStandardTickRate: number,
): number {
	if (tickNumber === 0) {
		return 0
	}
	return 1 + (tickNumber - 1) * nextStandardTickRate / previousStandardTickRate
}

/** 当前真实 tick 只有能被目标频率精确表达时才允许作为热切换锚点。 */
export function convertSimulationPhaseTickBetweenRatesExact(
	tickNumber: number,
	previousStandardTickRate: number,
	nextStandardTickRate: number,
): number | null {
	if (
		!Number.isSafeInteger(tickNumber)
		|| tickNumber < 0
		|| !Number.isSafeInteger(previousStandardTickRate)
		|| previousStandardTickRate <= 0
		|| !Number.isSafeInteger(nextStandardTickRate)
		|| nextStandardTickRate <= 0
	) {
		return null
	}
	const converted = convertSimulationPhaseTickBetweenRates(
		tickNumber,
		previousStandardTickRate,
		nextStandardTickRate,
	)
	return Number.isSafeInteger(converted) && converted >= 0 ? converted : null
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
