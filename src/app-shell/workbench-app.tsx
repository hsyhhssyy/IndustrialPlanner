import type { CSSProperties } from "react";
import type { WorkbenchController } from "@/app-shell/controller/workbench-controller";
import { getSelectedEntityDefinitionName } from "@/app-shell/controller/workbench-controller";
import { useExternalStore } from "@/app-shell/hooks/use-external-store";
import type { EditorTool } from "@/editor-core/session/editor-session";
import { getStage1EntityDefinition } from "@/industrial-domain/registry/stage1-registry";
import { DEFAULT_RENDER_LAYERS } from "@/renderer/scene/types";

const TOOLBAR_TOOLS: EditorTool[] = [
  "select",
  "place",
  "belt",
  "pipe",
  "link",
  "inspect",
];

export interface WorkbenchAppProps {
  controller: WorkbenchController;
}

export function WorkbenchApp({ controller }: WorkbenchAppProps) {
  const snapshot = useExternalStore(controller);
  const selectedEntityId = snapshot.session.selection[0] ?? null;
  const selectedEntity = selectedEntityId
    ? snapshot.document.entities[selectedEntityId]
    : null;
  const selectedDefinition = selectedEntity
    ? getStage1EntityDefinition(snapshot.registry, selectedEntity.definitionId)
    : null;
  const selectedEntityRuntime = selectedEntityId
    ? snapshot.runtimeSnapshot.entityViews[selectedEntityId]
    : null;
  const selectedEntityName = getSelectedEntityDefinitionName(snapshot);

  return (
    <div className="workbench">
      <header className="toolbar">
        <div className="toolbar-group">
          <button
            className={snapshot.ui.mode === "edit" ? "is-active" : undefined}
            onClick={() => controller.setMode("edit")}
            type="button"
          >
            Edit
          </button>
          <button
            className={snapshot.ui.mode === "simulate" ? "is-active" : undefined}
            onClick={() => controller.setMode("simulate")}
            type="button"
          >
            Simulate
          </button>
          <button onClick={() => controller.startSimulation()} type="button">
            Start
          </button>
          <button onClick={() => controller.pauseSimulation()} type="button">
            Pause
          </button>
          <button onClick={() => controller.stepSimulation()} type="button">
            Step
          </button>
        </div>
        <div className="toolbar-group">
          {TOOLBAR_TOOLS.map((tool) => (
            <button
              key={tool}
              className={
                snapshot.session.activeTool === tool ? "is-active" : undefined
              }
              onClick={() => controller.setActiveTool(tool)}
              type="button"
            >
              {tool}
            </button>
          ))}
        </div>
        <div className="toolbar-meta">
          <span>Mode: {snapshot.ui.mode}</span>
          <span>Tick: {snapshot.runtimeSnapshot.tick}</span>
          <span>Zoom: {(snapshot.session.viewport.zoom * 100).toFixed(0)}%</span>
        </div>
      </header>

      <aside className="dock dock-left">
        <section className="dock-section">
          <div className="section-header">
            <h2>Stage1 Registry</h2>
            <span className="pill is-ok">
              {snapshot.registry.entityDefinitions.length} defs
            </span>
          </div>
          <div className="section-body stack">
            <div className="cluster">
              <div className="pill-row">
                <span className="pill">
                  {snapshot.registry.itemDefinitions.length} items
                </span>
                <span className="pill">
                  {snapshot.registry.recipeDefinitions.length} recipes
                </span>
              </div>
              <p className="mono-line">{snapshot.ui.statusMessage}</p>
            </div>
            <div className="definition-list">
              {snapshot.registry.entityDefinitions.map((definition) => (
                <article className="definition-card" key={definition.id}>
                  <h4>{definition.name}</h4>
                  <p>{definition.id}</p>
                  <div className="pill-row" style={{ marginTop: "8px" }}>
                    {definition.capabilityIds.slice(0, 3).map((capabilityId) => (
                      <span className="pill" key={capabilityId}>
                        {capabilityId}
                      </span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      </aside>

      <main className="canvas-panel">
        <div className="canvas-header">
          <div className="pill-row">
            <span className="pill is-ok">React Shell</span>
            <span className="pill is-ok">External Store</span>
            <span className="pill">
              {snapshot.topology.diagnostics.length} diagnostics
            </span>
          </div>
          <div className="toolbar-group">
            <button onClick={() => controller.zoomOut()} type="button">
              -
            </button>
            <button onClick={() => controller.zoomIn()} type="button">
              +
            </button>
          </div>
        </div>
        <div className="canvas-stage">
          <div
            className="canvas-surface"
            style={
              {
                transform: `scale(${snapshot.session.viewport.zoom})`,
              } as CSSProperties
            }
          >
            {snapshot.document.entityOrder.map((entityId) => {
              const entity = snapshot.document.entities[entityId];

              if (!entity) {
                return null;
              }

              const definition = getStage1EntityDefinition(
                snapshot.registry,
                entity.definitionId,
              );
              const runtimeView = snapshot.runtimeSnapshot.entityViews[entityId];

              return (
                <button
                  className={[
                    "entity-node",
                    snapshot.session.selection.includes(entityId)
                      ? "is-selected"
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  key={entityId}
                  onClick={() => {
                    void controller.selectEntity(entityId);
                  }}
                  style={
                    {
                      left: `${entity.position.x * 56}px`,
                      top: `${entity.position.y * 56}px`,
                    } as CSSProperties
                  }
                  type="button"
                >
                  <h3>{definition?.name ?? entity.definitionId}</h3>
                  <p>{entity.id}</p>
                  <div className="pill-row" style={{ marginTop: "10px" }}>
                    <span className="pill">{entity.rotation} deg</span>
                    <span className="pill">{runtimeView?.status ?? "idle"}</span>
                  </div>
                  <div className="entity-progress">
                    <span
                      style={{ width: `${(runtimeView?.progress ?? 0) * 100}%` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </main>

      <aside className="dock dock-right">
        <section className="dock-section">
          <div className="section-header">
            <h2>Inspector</h2>
            <span className="pill">
              {selectedEntityName ?? "No selection"}
            </span>
          </div>
          <div className="section-body stack">
            {selectedEntity && selectedDefinition ? (
              <>
                <dl className="kv-grid">
                  <div className="kv">
                    <dt>Definition</dt>
                    <dd>{selectedDefinition.name}</dd>
                  </div>
                  <div className="kv">
                    <dt>Entity ID</dt>
                    <dd>{selectedEntity.id}</dd>
                  </div>
                  <div className="kv">
                    <dt>Mode</dt>
                    <dd>{snapshot.session.mode}</dd>
                  </div>
                  <div className="kv">
                    <dt>Runtime</dt>
                    <dd>{selectedEntityRuntime?.status ?? "idle"}</dd>
                  </div>
                </dl>
                <div className="cluster">
                  <div className="section-header">
                    <h3>Config Fields</h3>
                  </div>
                  <div className="definition-list">
                    {selectedDefinition.configFields.length === 0 ? (
                      <article className="definition-card">
                        <p>No configurable fields in scaffold yet.</p>
                      </article>
                    ) : (
                      selectedDefinition.configFields.map((field) => (
                        <article className="definition-card" key={field.key}>
                          <h4>{field.label}</h4>
                          <p>{field.mutability}</p>
                        </article>
                      ))
                    )}
                  </div>
                </div>
                <div className="cluster">
                  <div className="section-header">
                    <h3>Runtime Detail Lane</h3>
                  </div>
                  <div className="definition-list">
                    {(snapshot.inspectorDetails?.entityId === selectedEntity.id
                      ? snapshot.inspectorDetails.lines
                      : ["Inspector query lane will populate details here."]
                    ).map((line) => (
                      <article className="definition-card" key={line}>
                        <p>{line}</p>
                      </article>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <article className="definition-card">
                <h4>No Selection</h4>
                <p>Select a canvas entity to inspect document, topology and runtime slices.</p>
              </article>
            )}
          </div>
        </section>
      </aside>

      <section className="dock dock-bottom">
        <div className="dock-section">
          <div className="section-header">
            <h2>Diagnostics And Status</h2>
            <div className="footer-strip">
              <span className="pill">
                Tick {snapshot.telemetry.tick}
              </span>
              <span className="pill">
                Sim {snapshot.telemetry.simulatedHertz} Hz
              </span>
              <span className="pill">
                Entities {snapshot.telemetry.entityCount}
              </span>
            </div>
          </div>
          <div className="section-body stack">
            <div className="definition-list">
              {snapshot.topology.diagnostics.map((diagnostic) => (
                <article className="log-card" key={diagnostic.id}>
                  <h4>{diagnostic.severity.toUpperCase()}</h4>
                  <p>{diagnostic.message}</p>
                </article>
              ))}
            </div>
            <div className="pill-row">
              {DEFAULT_RENDER_LAYERS.map((layer) => (
                <span className="pill" key={layer.id}>
                  {layer.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
