import { useEffect } from "react"
import { GridCanvas } from "./components/GridCanvas"
import { LeftToolbar } from "./components/LeftToolbar"
import { RightPanel } from "./components/RightPanel"
import { TopBar } from "./components/TopBar"
import { useAppStore } from "./state/appStore"

export default function App() {
  const mode = useAppStore((state) => state.mode)
  const speed = useAppStore((state) => state.speed)
  const logisticsMode = useAppStore((state) => state.logisticsMode)
  const rotateSelectedMachine = useAppStore((state) => state.rotateSelectedMachine)
  const deleteSelectedMachine = useAppStore((state) => state.deleteSelectedMachine)
  const cancelBeltDraw = useAppStore((state) => state.cancelBeltDraw)
  const stepSimulationTick = useAppStore((state) => state.stepSimulationTick)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (mode !== "edit") {
        return
      }

      if (event.key === "r" || event.key === "R") {
        rotateSelectedMachine()
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        deleteSelectedMachine()
      }

      if (event.key === "Escape" && logisticsMode === "belt") {
        cancelBeltDraw()
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [mode, logisticsMode, rotateSelectedMachine, deleteSelectedMachine, cancelBeltDraw])

  useEffect(() => {
    if (mode !== "simulate") {
      return
    }

    const timer = window.setInterval(() => {
      for (let index = 0; index < speed; index += 1) {
        stepSimulationTick()
      }
    }, 100)

    return () => window.clearInterval(timer)
  }, [mode, speed, stepSimulationTick])

  return (
    <div className="app-root">
      <TopBar />
      <div className="layout-shell">
        <LeftToolbar />
        <GridCanvas />
        <RightPanel />
      </div>
    </div>
  )
}
