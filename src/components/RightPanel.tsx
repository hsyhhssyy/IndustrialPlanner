import { useAppStore } from "../state/appStore"
import { BUILDING_PROTOTYPE_MAP, GRID_SIZE_OPTIONS } from "../types/domain"

export function RightPanel() {
  const mode = useAppStore((state) => state.mode)
  const selectedGridSize = useAppStore((state) => state.selectedGridSize)
  const setGridSize = useAppStore((state) => state.setGridSize)
  const externalInventory = useAppStore((state) => state.externalInventory)
  const productionPerMin = useAppStore((state) => state.productionPerMin)
  const consumptionPerMin = useAppStore((state) => state.consumptionPerMin)
  const selectedMachineId = useAppStore((state) => state.selectedMachineId)
  const selectedBeltSegmentKey = useAppStore((state) => state.selectedBeltSegmentKey)
  const beltEdges = useAppStore((state) => state.beltEdges)
  const beltTransitItems = useAppStore((state) => state.beltTransitItems)
  const machineRuntime = useAppStore((state) => state.machineRuntime)
  const machineProgress = useAppStore((state) => state.machineProgress)
  const machineInternal = useAppStore((state) => state.machineInternal)
  const tickCount = useAppStore((state) => state.tickCount)
  const pickupPortConfigs = useAppStore((state) => state.pickupPortConfigs)
  const setPickupPortSelectedItem = useAppStore((state) => state.setPickupPortSelectedItem)
  const selectedMachine = useAppStore((state) =>
    state.machines.find((machine) => machine.id === state.selectedMachineId),
  )

  const selectedPickupItem =
    selectedMachine && selectedMachine.prototypeId === "pickup_port_3x1"
      ? pickupPortConfigs[selectedMachine.id]?.selectedItemId ?? null
      : null

  const selectedSegmentTransitItems = selectedBeltSegmentKey
    ? beltTransitItems.filter((item) => {
        if (item.path.length === 0) {
          return false
        }

        const currentPoint = item.path[Math.min(item.stepIndex, item.path.length - 1)]
        if (!currentPoint) {
          return false
        }

        return `${currentPoint.x},${currentPoint.y}` === selectedBeltSegmentKey
      })
    : []

  const segmentLinkedEdges = selectedBeltSegmentKey
    ? beltEdges.filter((edge) => {
        for (let index = 0; index < edge.path.length; index += 1) {
          const point = edge.path[index]
          if (!point) {
            continue
          }
          if (`${point.x},${point.y}` === selectedBeltSegmentKey) {
            return true
          }
        }
        return false
      })
    : []

  const oreCount = selectedSegmentTransitItems.filter((item) => item.itemId === "originium_ore").length
  const powderCount = selectedSegmentTransitItems.filter((item) => item.itemId === "originium_powder").length

  const selectedMachineStorageCapacity = selectedMachine
    ? BUILDING_PROTOTYPE_MAP[selectedMachine.prototypeId].storageCapacity
    : undefined

  const selectedMachineInputStorageCapacity = selectedMachine
    ? BUILDING_PROTOTYPE_MAP[selectedMachine.prototypeId].inputStorageCapacity
    : undefined

  const selectedMachineOutputStorageCapacity = selectedMachine
    ? BUILDING_PROTOTYPE_MAP[selectedMachine.prototypeId].outputStorageCapacity
    : undefined

  const selectedMachineStoredOre = selectedMachine
    ? machineInternal[`${selectedMachine.id}:in:originium_ore`] ?? 0
    : 0

  const selectedMachineStoredPowder = selectedMachine
    ? machineInternal[`${selectedMachine.id}:out:originium_powder`] ?? 0
    : 0

  const selectedMachineStoredTotal = selectedMachineStoredOre + selectedMachineStoredPowder

  return (
    <aside className="right-panel">
      <section className="panel-card">
        <h2>全局统计（系统外库存）</h2>
        <p className="note">不包含地块内机器、传送带、仓储建筑中的物品</p>
        <p className="note">仿真秒数：{(tickCount / 10).toFixed(1)} s</p>
        <table className="stat-table">
          <thead>
            <tr>
              <th>物品名称</th>
              <th>生产/min</th>
              <th>消耗/min</th>
              <th>库存</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>源石矿</td>
              <td>{productionPerMin.originium_ore}</td>
              <td>{consumptionPerMin.originium_ore}</td>
              <td>∞</td>
            </tr>
            <tr>
              <td>原矿粉末</td>
              <td>{productionPerMin.originium_powder}</td>
              <td>{consumptionPerMin.originium_powder}</td>
              <td>{externalInventory.originium_powder}</td>
            </tr>
          </tbody>
        </table>
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

            {typeof selectedMachineStorageCapacity === "number" && (
              <>
                <div>内部存储</div>
                <div>
                  {selectedMachineStoredTotal} / {selectedMachineStorageCapacity}
                </div>
                <div>存储-源石矿</div>
                <div>{selectedMachineStoredOre}</div>
                <div>存储-原矿粉末</div>
                <div>{selectedMachineStoredPowder}</div>
              </>
            )}

            {typeof selectedMachineInputStorageCapacity === "number" && (
              <>
                <div>输入仓（矿）</div>
                <div>
                  {selectedMachineStoredOre} / {selectedMachineInputStorageCapacity}
                </div>
              </>
            )}

            {typeof selectedMachineOutputStorageCapacity === "number" && (
              <>
                <div>输出仓（粉）</div>
                <div>
                  {selectedMachineStoredPowder} / {selectedMachineOutputStorageCapacity}
                </div>
              </>
            )}

            {selectedMachine.prototypeId === "pickup_port_3x1" && (
              <>
                <div>出货物品</div>
                <div>
                  <select
                    value={selectedPickupItem ?? ""}
                    onChange={(event) =>
                      setPickupPortSelectedItem(
                        selectedMachine.id,
                        event.target.value === "" ? null : (event.target.value as "originium_ore" | "originium_powder"),
                      )
                    }
                    disabled={mode !== "edit"}
                  >
                    <option value="">未选择（?）</option>
                    <option value="originium_ore">源石矿</option>
                    <option value="originium_powder">原矿粉末</option>
                  </select>
                </div>
              </>
            )}
          </div>
        )}
      </section>

      <section className="panel-card">
        <h2>当前选中传送带段</h2>
        {!selectedBeltSegmentKey ? (
          <p className="note">未选中传送带段（选择模式下点击传送带）</p>
        ) : (
          <div className="stat-grid">
            <div>段Key</div>
            <div>{selectedBeltSegmentKey}</div>
            <div>在途物品数</div>
            <div>{selectedSegmentTransitItems.length}</div>
            <div>逻辑连接覆盖</div>
            <div>{segmentLinkedEdges.length > 0 ? "是" : "否"}</div>
            <div>关联连接ID</div>
            <div>{segmentLinkedEdges.map((edge) => edge.id).join(", ") || "-"}</div>
            <div>源石矿小盒子</div>
            <div>{oreCount}</div>
            <div>原矿粉末小盒子</div>
            <div>{powderCount}</div>
          </div>
        )}
      </section>
    </aside>
  )
}
