import { useAppStore } from "../state/appStore"
import { GRID_SIZE_OPTIONS } from "../types/domain"

export function RightPanel() {
  const mode = useAppStore((state) => state.mode)
  const selectedGridSize = useAppStore((state) => state.selectedGridSize)
  const setGridSize = useAppStore((state) => state.setGridSize)
  const externalInventory = useAppStore((state) => state.externalInventory)
  const productionPerMin = useAppStore((state) => state.productionPerMin)
  const consumptionPerMin = useAppStore((state) => state.consumptionPerMin)
  const selectedMachineId = useAppStore((state) => state.selectedMachineId)
  const machineRuntime = useAppStore((state) => state.machineRuntime)
  const machineProgress = useAppStore((state) => state.machineProgress)
  const tickCount = useAppStore((state) => state.tickCount)
  const selectedMachine = useAppStore((state) =>
    state.machines.find((machine) => machine.id === state.selectedMachineId),
  )

  return (
    <aside className="right-panel">
      <section className="panel-card">
        <h2>全局统计（系统外库存）</h2>
        <p className="note">不包含地块内机器、传送带、仓储建筑中的物品</p>
        <p className="note">仿真 Tick：{tickCount}</p>
        <div className="stat-grid">
          <div>源石矿库存</div>
          <div>∞</div>
          <div>原矿粉末库存</div>
          <div>{externalInventory.originium_powder}</div>
          <div>源石矿 /min 生产</div>
          <div>{productionPerMin.originium_ore}</div>
          <div>源石矿 /min 消耗</div>
          <div>{consumptionPerMin.originium_ore}</div>
          <div>原矿粉末 /min 生产</div>
          <div>{productionPerMin.originium_powder}</div>
          <div>原矿粉末 /min 消耗</div>
          <div>{consumptionPerMin.originium_powder}</div>
        </div>
      </section>

      <section className="panel-card">
        <h2>地块尺寸</h2>
        <div className="chip-row">
          {GRID_SIZE_OPTIONS.map((size) => (
            <button
              key={size}
              className={selectedGridSize === size ? "speed-btn active" : "speed-btn"}
              onClick={() => {
                if (size === selectedGridSize) {
                  return
                }

                const confirmed = window.confirm(
                  `将切换到 ${size}x${size} 地块。系统会先保存当前地块并加载目标地块存档，是否继续？`,
                )
                if (!confirmed) {
                  return
                }
                setGridSize(size)
              }}
              disabled={mode !== "edit"}
            >
              {size}x{size}
            </button>
          ))}
        </div>
      </section>

      <section className="panel-card">
        <h2>当前选中建筑</h2>
        {!selectedMachineId || !selectedMachine ? (
          <p className="note">未选中建筑</p>
        ) : (
          <div className="stat-grid">
            <div>ID</div>
            <div>{selectedMachine.id}</div>
            <div>类型</div>
            <div>{selectedMachine.name}</div>
            <div>坐标</div>
            <div>
              ({selectedMachine.x}, {selectedMachine.y})
            </div>
            <div>朝向</div>
            <div>{selectedMachine.rotation}°</div>
            <div>状态</div>
            <div>{machineRuntime[selectedMachine.id]?.status ?? "idle"}</div>
            <div>进度</div>
            <div>{machineProgress[selectedMachine.id] ?? 0} tick</div>
            <div>缺失输入</div>
            <div>{(machineRuntime[selectedMachine.id]?.missingInputs ?? []).join(",") || "-"}</div>
          </div>
        )}
      </section>
    </aside>
  )
}
