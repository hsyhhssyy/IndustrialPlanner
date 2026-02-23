import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { LayoutState, SimState } from '../../domain/types'
import { createInitialSimState, tickSimulation } from '../../sim/engine'

type UseSimulationDomainParams = {
  layoutRef: RefObject<LayoutState>
}

export function useSimulationDomain({ layoutRef }: UseSimulationDomainParams) {
  const [sim, setSim] = useState<SimState>(() => createInitialSimState())
  const [measuredTickRate, setMeasuredTickRate] = useState(0)

  const simStateRef = useRef(sim)
  const simRafRef = useRef<number | null>(null)
  const simAccumulatorMsRef = useRef(0)
  const simLastFrameMsRef = useRef(0)
  const simUiLastCommitMsRef = useRef(0)
  const tickRateSampleRef = useRef<{ tick: number; ms: number } | null>(null)
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
    if (!sim.isRunning) return

    const maxTicksPerFrame = 8
    const stepMs = 1000 / (sim.tickRateHz * sim.speed)
    const effectiveTickRate = sim.tickRateHz * sim.speed
    const targetUiFps = Math.max(5, Math.min(30, effectiveTickRate))
    const uiCommitIntervalMs = 1000 / targetUiFps

    const onFrame = (nowMs: number) => {
      if (simLastFrameMsRef.current === 0) {
        simLastFrameMsRef.current = nowMs
      }

      const deltaMs = nowMs - simLastFrameMsRef.current
      simLastFrameMsRef.current = nowMs
      simAccumulatorMsRef.current += Math.max(0, deltaMs)

      const dueTicks = Math.floor(simAccumulatorMsRef.current / stepMs)
      const ticksToRun = Math.min(maxTicksPerFrame, dueTicks)

      if (ticksToRun > 0) {
        simAccumulatorMsRef.current -= ticksToRun * stepMs
        let next = simStateRef.current
        const layout = layoutRef.current
        if (!layout) return
        for (let i = 0; i < ticksToRun; i += 1) {
          next = tickSimulation(layout, next)
        }
        simStateRef.current = next
        simTickRef.current = next.tick

        if (simUiLastCommitMsRef.current === 0 || nowMs - simUiLastCommitMsRef.current >= uiCommitIntervalMs) {
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
    }
  }, [layoutRef, sim.isRunning, sim.speed, sim.tickRateHz])

  useEffect(() => {
    const autoPauseSimulation = () => {
      updateSim((current) => {
        if (!current.isRunning || current.speed === 0) return current
        return { ...current, speed: 0 }
      })
    }

    const onVisibilityChange = () => {
      if (document.hidden) {
        autoPauseSimulation()
      }
    }

    const onWindowBlur = () => {
      autoPauseSimulation()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('blur', onWindowBlur)

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('blur', onWindowBlur)
    }
  }, [updateSim])

  useEffect(() => {
    if (!sim.isRunning) {
      setMeasuredTickRate(0)
      tickRateSampleRef.current = null
      return
    }

    tickRateSampleRef.current = { tick: simTickRef.current, ms: performance.now() }
    const timer = window.setInterval(() => {
      const prev = tickRateSampleRef.current
      if (!prev) {
        tickRateSampleRef.current = { tick: simTickRef.current, ms: performance.now() }
        return
      }
      const nowMs = performance.now()
      const currentTick = simTickRef.current
      const deltaTick = currentTick - prev.tick
      const deltaSec = (nowMs - prev.ms) / 1000
      if (deltaSec > 0) setMeasuredTickRate(deltaTick / deltaSec)
      tickRateSampleRef.current = { tick: currentTick, ms: nowMs }
    }, 1000)

    return () => window.clearInterval(timer)
  }, [sim.isRunning])

  return {
    sim,
    updateSim,
    measuredTickRate,
    simStateRef,
    simTickRef,
  }
}
