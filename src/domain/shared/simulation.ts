export function cycleTicksFromSeconds(cycleSeconds: number, tickRateHz: number) {
  return Math.max(1, Math.round(cycleSeconds * tickRateHz))
}