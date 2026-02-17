import { useAppStore } from "../state/appStore"
import type { SimulationSpeed } from "../types/domain"

const SPEED_OPTIONS: SimulationSpeed[] = [1, 2, 4]

export function TopBar() {
  const mode = useAppStore((state) => state.mode)
  const speed = useAppStore((state) => state.speed)
  const toastMessage = useAppStore((state) => state.toastMessage)
  const clearToast = useAppStore((state) => state.clearToast)
  const startSimulation = useAppStore((state) => state.startSimulation)
  const stopSimulationAndResetAll = useAppStore((state) => state.stopSimulationAndResetAll)
  const resetAllRuntime = useAppStore((state) => state.resetAllRuntime)
  const setSpeed = useAppStore((state) => state.setSpeed)

  return (
    <header className="top-bar">
      <div className="top-bar-left">
        <button
          className="primary-btn"
          onClick={mode === "edit" ? startSimulation : stopSimulationAndResetAll}
        >
          {mode === "edit" ? "开始仿真" : "退出仿真"}
        </button>
        <button className="speed-btn" onClick={resetAllRuntime}>
          重置库存
        </button>
      </div>
      <div className="top-bar-right">
        {toastMessage && (
          <button className="toast-btn" onClick={clearToast} title={toastMessage}>
            {toastMessage}
          </button>
        )}
        {SPEED_OPTIONS.map((option) => (
          <button
            key={option}
            className={option === speed ? "speed-btn active" : "speed-btn"}
            onClick={() => setSpeed(option)}
            disabled={mode === "edit"}
          >
            {option}x
          </button>
        ))}
      </div>
    </header>
  )
}
