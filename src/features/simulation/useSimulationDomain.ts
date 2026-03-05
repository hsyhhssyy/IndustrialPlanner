import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { LayoutState, SimState } from '../../domain/types'
import { createInitialSimState, tickSimulation } from '../../sim/engine'

type UseSimulationDomainParams = {
  layoutRef: RefObject<LayoutState>
}

type TimedSample = { ms: number; value: number }

const PROBE_WINDOW_MS = 60_000

function pushTimedSample(queue: TimedSample[], ms: number, value: number) {
  queue.push({ ms, value })
  const cutoff = ms - PROBE_WINDOW_MS
  while (queue.length > 0 && queue[0].ms < cutoff) {
    queue.shift()
  }
}

function summarizeTimedSamples(queue: TimedSample[]) {
  if (queue.length === 0) {
    return { avg: 0, min: 0, max: 0 }
  }

  let sum = 0
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const sample of queue) {
    const value = sample.value
    sum += value
    if (value < min) min = value
    if (value > max) max = value
  }

  return {
    avg: sum / queue.length,
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) ? max : 0,
  }
}

function countTimedSamplesAtLeast(queue: TimedSample[], threshold: number) {
  let count = 0
  for (const sample of queue) {
    if (sample.value >= threshold) count += 1
  }
  return count
}

export function useSimulationDomain({ layoutRef }: UseSimulationDomainParams) {
  const [sim, setSim] = useState<SimState>(() => createInitialSimState())
  const [measuredTickRate, setMeasuredTickRate] = useState(0)
  const [measuredFrameRate, setMeasuredFrameRate] = useState(0)
  const [smoothedFrameRate, setSmoothedFrameRate] = useState(0)
  const [minFrameRate, setMinFrameRate] = useState(0)
  const [maxFrameRate, setMaxFrameRate] = useState(0)
  const [longFrame50Count, setLongFrame50Count] = useState(0)
  const [longFrame100Count, setLongFrame100Count] = useState(0)
  const [maxFrameTimeMs, setMaxFrameTimeMs] = useState(0)
  const [avgFrameTimeMs, setAvgFrameTimeMs] = useState(0)
  const [avgTicksPerFrame, setAvgTicksPerFrame] = useState(0)
  const [maxTicksPerFrameSeen, setMaxTicksPerFrameSeen] = useState(0)
  const [avgTickWorkMs, setAvgTickWorkMs] = useState(0)
  const [maxTickWorkMs, setMaxTickWorkMs] = useState(0)
  const [avgUiCommitGapMs, setAvgUiCommitGapMs] = useState(0)
  const [maxUiCommitGapMs, setMaxUiCommitGapMs] = useState(0)

  const simStateRef = useRef(sim)
  const simRafRef = useRef<number | null>(null)
  const simAccumulatorMsRef = useRef(0)
  const simLastFrameMsRef = useRef(0)
  const simUiLastCommitMsRef = useRef(0)
  const metricsSampleRef = useRef<{ tick: number; frame: number; ms: number } | null>(null)
  const simFrameRef = useRef(0)
  const fpsEmaRef = useRef<number | null>(null)
  const frameTimeSamplesRef = useRef<TimedSample[]>([])
  const instantFpsSamplesRef = useRef<TimedSample[]>([])
  const ticksPerFrameSamplesRef = useRef<TimedSample[]>([])
  const tickWorkSamplesRef = useRef<TimedSample[]>([])
  const uiCommitGapSamplesRef = useRef<TimedSample[]>([])
  const simTickRef = useRef(0)

  const updateSim = useCallback((updater: (current: SimState) => SimState) => {
    const next = updater(simStateRef.current)
    simStateRef.current = next
    simTickRef.current = next.tick
    setSim(next)
    return next
  }, [])

  useEffect(() => {
    simStateRef.current = sim
    simTickRef.current = sim.tick
  }, [sim])

  useEffect(() => {
    if (simRafRef.current !== null) {
      window.cancelAnimationFrame(simRafRef.current)
      simRafRef.current = null
    }

    simAccumulatorMsRef.current = 0
    simLastFrameMsRef.current = 0
    simUiLastCommitMsRef.current = 0
    metricsSampleRef.current = null
    simFrameRef.current = 0
    fpsEmaRef.current = null
    frameTimeSamplesRef.current = []
    instantFpsSamplesRef.current = []
    ticksPerFrameSamplesRef.current = []
    tickWorkSamplesRef.current = []
    uiCommitGapSamplesRef.current = []
    setMeasuredTickRate(0)
    setMeasuredFrameRate(0)
    setSmoothedFrameRate(0)
    setMinFrameRate(0)
    setMaxFrameRate(0)
    setLongFrame50Count(0)
    setLongFrame100Count(0)
    setMaxFrameTimeMs(0)
    setAvgFrameTimeMs(0)
    setAvgTicksPerFrame(0)
    setMaxTicksPerFrameSeen(0)
    setAvgTickWorkMs(0)
    setMaxTickWorkMs(0)
    setAvgUiCommitGapMs(0)
    setMaxUiCommitGapMs(0)
    if (!sim.isRunning) return

    const maxTicksPerFrame = 8
    const stepMs = 1000 / (sim.tickRateHz * sim.speed)
    const effectiveTickRate = sim.tickRateHz * sim.speed
    const targetUiFps = Math.max(5, Math.min(30, effectiveTickRate))
    const uiCommitIntervalMs = 1000 / targetUiFps
    const emaAlpha = 2 / (30 + 1)

    const onFrame = (nowMs: number) => {
      simFrameRef.current += 1

      if (simLastFrameMsRef.current === 0) {
        simLastFrameMsRef.current = nowMs
      }

      const deltaMs = nowMs - simLastFrameMsRef.current
      simLastFrameMsRef.current = nowMs
      if (deltaMs > 0) {
        pushTimedSample(frameTimeSamplesRef.current, nowMs, deltaMs)

        const instantFps = 1000 / deltaMs
        pushTimedSample(instantFpsSamplesRef.current, nowMs, instantFps)
        const previousEma = fpsEmaRef.current
        const nextEma = previousEma === null ? instantFps : previousEma + emaAlpha * (instantFps - previousEma)
        fpsEmaRef.current = nextEma
      }

      simAccumulatorMsRef.current += Math.max(0, deltaMs)

      const dueTicks = Math.floor(simAccumulatorMsRef.current / stepMs)
      const ticksToRun = Math.min(maxTicksPerFrame, dueTicks)
      pushTimedSample(ticksPerFrameSamplesRef.current, nowMs, ticksToRun)

      if (ticksToRun > 0) {
        const tickWorkStartMs = performance.now()
        simAccumulatorMsRef.current -= ticksToRun * stepMs
        let next = simStateRef.current
        const layout = layoutRef.current
        if (!layout) return
        for (let i = 0; i < ticksToRun; i += 1) {
          next = tickSimulation(layout, next)
        }
        const tickWorkMs = performance.now() - tickWorkStartMs
        pushTimedSample(tickWorkSamplesRef.current, nowMs, tickWorkMs)
        simStateRef.current = next
        simTickRef.current = next.tick

        if (simUiLastCommitMsRef.current === 0 || nowMs - simUiLastCommitMsRef.current >= uiCommitIntervalMs) {
          if (simUiLastCommitMsRef.current !== 0) {
            const commitGap = nowMs - simUiLastCommitMsRef.current
            pushTimedSample(uiCommitGapSamplesRef.current, nowMs, commitGap)
          }

          const previousMetricsSample = metricsSampleRef.current
          if (previousMetricsSample) {
            const deltaTick = next.tick - previousMetricsSample.tick
            const deltaFrame = simFrameRef.current - previousMetricsSample.frame
            const deltaSec = (nowMs - previousMetricsSample.ms) / 1000
            if (deltaSec > 0) {
              setMeasuredTickRate(deltaTick / deltaSec)
              setMeasuredFrameRate(deltaFrame / deltaSec)
            }
          }
          metricsSampleRef.current = { tick: next.tick, frame: simFrameRef.current, ms: nowMs }

          const fpsSummary = summarizeTimedSamples(instantFpsSamplesRef.current)
          const frameTimeSummary = summarizeTimedSamples(frameTimeSamplesRef.current)
          const ticksPerFrameSummary = summarizeTimedSamples(ticksPerFrameSamplesRef.current)
          const tickWorkSummary = summarizeTimedSamples(tickWorkSamplesRef.current)
          const uiCommitGapSummary = summarizeTimedSamples(uiCommitGapSamplesRef.current)

          setSmoothedFrameRate(fpsEmaRef.current ?? 0)
          setMinFrameRate(fpsSummary.min)
          setMaxFrameRate(fpsSummary.max)
          setLongFrame50Count(countTimedSamplesAtLeast(frameTimeSamplesRef.current, 50))
          setLongFrame100Count(countTimedSamplesAtLeast(frameTimeSamplesRef.current, 100))
          setMaxFrameTimeMs(frameTimeSummary.max)
          setAvgFrameTimeMs(frameTimeSummary.avg)
          setAvgTicksPerFrame(ticksPerFrameSummary.avg)
          setMaxTicksPerFrameSeen(Math.round(ticksPerFrameSummary.max))
          setAvgTickWorkMs(tickWorkSummary.avg)
          setMaxTickWorkMs(tickWorkSummary.max)
          setAvgUiCommitGapMs(uiCommitGapSummary.avg)
          setMaxUiCommitGapMs(uiCommitGapSummary.max)

          simUiLastCommitMsRef.current = nowMs
          setSim(next)
        }
      }

      simRafRef.current = window.requestAnimationFrame(onFrame)
    }

    simRafRef.current = window.requestAnimationFrame(onFrame)

    return () => {
      if (simRafRef.current !== null) {
        window.cancelAnimationFrame(simRafRef.current)
        simRafRef.current = null
      }
      simAccumulatorMsRef.current = 0
      simLastFrameMsRef.current = 0
      simUiLastCommitMsRef.current = 0
      metricsSampleRef.current = null
    }
  }, [layoutRef, sim.isRunning, sim.speed, sim.tickRateHz])

  return {
    sim,
    updateSim,
    measuredTickRate,
    measuredFrameRate,
    smoothedFrameRate,
    minFrameRate,
    maxFrameRate,
    longFrame50Count,
    longFrame100Count,
    maxFrameTimeMs,
    avgFrameTimeMs,
    avgTicksPerFrame,
    maxTicksPerFrameSeen,
    avgTickWorkMs,
    maxTickWorkMs,
    avgUiCommitGapMs,
    maxUiCommitGapMs,
    simStateRef,
    simTickRef,
  }
}
