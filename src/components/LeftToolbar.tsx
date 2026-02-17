import { BUILDING_PROTOTYPES } from "../types/domain"
import { useAppStore } from "../state/appStore"

export function LeftToolbar() {
  const mode = useAppStore((state) => state.mode)
  const activePrototypeId = useAppStore((state) => state.activePrototypeId)
  const interactionMode = useAppStore((state) => state.interactionMode)
  const setActivePrototype = useAppStore((state) => state.setActivePrototype)
  const setInteractionMode = useAppStore((state) => state.setInteractionMode)
  const logisticsMode = useAppStore((state) => state.logisticsMode)
  const setLogisticsMode = useAppStore((state) => state.setLogisticsMode)
  const beltDeleteMode = useAppStore((state) => state.beltDeleteMode)
  const setBeltDeleteMode = useAppStore((state) => state.setBeltDeleteMode)
  const deleteAllMachines = useAppStore((state) => state.deleteAllMachines)

  return (
    <aside className="left-toolbar">
      <h2>工具栏</h2>
      <section>
        <div className="chip-row">
          <button
            className={interactionMode === "idle" ? "speed-btn active" : "speed-btn"}
            onClick={() => setInteractionMode("idle")}
            disabled={mode !== "edit"}
          >
            选择
          </button>
          <button
            className={interactionMode === "place" ? "speed-btn active" : "speed-btn"}
            onClick={() => setInteractionMode("place")}
            disabled={mode !== "edit"}
          >
            放置
          </button>
          <button
            className={interactionMode === "logistics" ? "speed-btn active" : "speed-btn"}
            onClick={() => setInteractionMode("logistics")}
            disabled={mode !== "edit"}
          >
            物流
          </button>
          <button
            className={interactionMode === "delete" ? "speed-btn active" : "speed-btn"}
            onClick={() => setInteractionMode("delete")}
            disabled={mode !== "edit"}
          >
            删除
          </button>
        </div>
      </section>

      <div className="toolbar-divider" />

      {interactionMode === "place" && (
        <section>
          <h3>建筑</h3>
          <div className="prototype-list">
            {BUILDING_PROTOTYPES.map((prototype) => (
              <button
                key={prototype.id}
                className={prototype.id === activePrototypeId ? "speed-btn active" : "speed-btn"}
                onClick={() => setActivePrototype(prototype.id)}
                disabled={mode !== "edit" || logisticsMode !== "none"}
              >
                {prototype.name} {prototype.w}x{prototype.h}
              </button>
            ))}
          </div>
        </section>
      )}
      {interactionMode === "delete" && (
        <section>
          <h3>删除模式子菜单</h3>
          <button className="speed-btn" onClick={deleteAllMachines} disabled={mode !== "edit"}>
            删除所有建筑
          </button>
          <h3 style={{ marginTop: 12 }}>物流删除模式</h3>
          <div className="prototype-list" style={{ marginTop: 8 }}>
            <button
              className={beltDeleteMode === "by_cell" ? "speed-btn active" : "speed-btn"}
              onClick={() => setBeltDeleteMode("by_cell")}
              disabled={mode !== "edit"}
            >
              按格删除
            </button>
            <button
              className={
                beltDeleteMode === "by_connected_component" ? "speed-btn active" : "speed-btn"
              }
              onClick={() => setBeltDeleteMode("by_connected_component")}
              disabled={mode !== "edit"}
            >
              删除整条
            </button>
          </div>
        </section>
      )}

      {interactionMode === "logistics" && (
        <section>
          <h3>物流子模式</h3>
          <div className="chip-row">
            <button
              className={logisticsMode === "belt" ? "speed-btn active" : "speed-btn"}
              onClick={() => setLogisticsMode("belt")}
              disabled={mode !== "edit"}
            >
              传送带
            </button>
            <button
              className={logisticsMode === "pipe" ? "speed-btn active" : "speed-btn"}
              onClick={() => setLogisticsMode("pipe")}
              disabled={mode !== "edit"}
            >
              管道（占位）
            </button>
          </div>
        </section>
      )}
    </aside>
  )
}
