import type { WorkbenchController } from "@/app-shell/contracts/workbench-facade";
import { EditSelectionInspector } from "@/app-shell/components/inspector/edit-selection-inspector";
import type { SelectionInspectorContext } from "@/app-shell/components/inspector/selection-inspector-model";
import { SimulationSelectionInspector } from "@/app-shell/components/inspector/simulation-selection-inspector";
import { useExternalStore } from "@/app-shell/hooks/use-external-store";
import {
  RIGHT_BASE_GROUPS,
  RIGHT_BASE_SUMMARY,
  RIGHT_POWER_SUMMARY,
} from "@/app-shell/workbench-placeholders";
import { createTranslator } from "@/i18n/messages";
import { getLocalizedStage1EntityName } from "@/i18n/stage1-registry";
import { localizeWorkbenchText } from "@/i18n/workbench-placeholders";

export interface RightDockProps {
  controller: WorkbenchController;
}

export function RightDock({ controller }: RightDockProps) {
  const ui = useExternalStore(controller.uiStore);
  const editor = useExternalStore(controller.editorStore);
  const canvas = useExternalStore(controller.canvasStore);
  const topology = useExternalStore(controller.topologyStore);
  const simulation = useExternalStore(controller.simulationStore);

  if (!ui.rightDock.open) {
    return null;
  }

  const t = createTranslator(ui.locale);

  const selectedEntityId = canvas.activeCanvas.selectedEntityIds[0] ?? null;
  const selectedEntity = selectedEntityId
    ? editor.document.entities[selectedEntityId]
    : null;
  const selectedDefinition = selectedEntityId
    ? topology.entityViews[selectedEntityId]?.definition ?? null
    : null;
  const selectedEntityRuntime = selectedEntityId
    ? simulation.runtimeSnapshot.entityViews[selectedEntityId]
    : null;
  const selectedLinks = selectedEntityId
    ? editor.document.explicitLinks.filter(
        (link) =>
          link.sourceEntityId === selectedEntityId ||
          link.targetEntityId === selectedEntityId,
      )
    : [];
  const selectionContext: SelectionInspectorContext | null =
    selectedEntityId &&
    selectedEntity &&
    selectedDefinition
      ? {
          selectedEntityId,
          selectedEntity,
          selectedDefinition,
          selectedEntityRuntime: selectedEntityRuntime ?? undefined,
          selectedLinks,
        }
      : null;
  const inspectorState = {
    locale: ui.locale,
    mode: ui.mode,
    inspectorDetails: simulation.inspectorDetails,
    simulationPatchSet: simulation.patchSet,
  } as const;

  return (
    <aside className="dock dock-right panel-surface">
      <section className="dock-section">
        <div className="section-header">
          <h2>{t("rightDock.title")}</h2>
          <div className="header-actions">
            <span className="pill">
              {selectedDefinition
                ? getLocalizedStage1EntityName(ui.locale, selectedDefinition)
                : t("label.noSelection")}
            </span>
            <button
              onClick={() => controller.toggleDockCollapsed("right")}
              type="button"
            >
              {t(ui.rightDock.collapsed ? "action.expand" : "action.collapse")}
            </button>
          </div>
        </div>
        {!ui.rightDock.collapsed ? (
          <div className="section-body stack">
            <article className="inspector-card">
              <div className="card-header">
                <h3>{t("rightDock.base")}</h3>
              </div>
              <div className="stack">
                {RIGHT_BASE_GROUPS.map((group) => (
                  <div className="cluster" key={localizeWorkbenchText(ui.locale, group.title)}>
                    <h4 className="inspector-group-title">
                      {localizeWorkbenchText(ui.locale, group.title)}
                    </h4>
                    <div className="inspector-option-grid">
                      {group.options.map((option) => (
                        <button
                          className={option.active ? "is-active" : undefined}
                          key={option.id}
                          onClick={() => undefined}
                          type="button"
                        >
                          {localizeWorkbenchText(ui.locale, option.label)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <dl className="inspector-summary-list">
                  {RIGHT_BASE_SUMMARY.map((field) => (
                    <div className="inspector-summary-row" key={field.id}>
                      <dt>{localizeWorkbenchText(ui.locale, field.label)}</dt>
                      <dd>{localizeWorkbenchText(ui.locale, field.value)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </article>
            <article className="inspector-card">
              <div className="card-header">
                <h3>{t("rightDock.power")}</h3>
              </div>
              <dl className="inspector-summary-list">
                {RIGHT_POWER_SUMMARY.map((field) => (
                  <div className="inspector-summary-row" key={field.id}>
                    <dt>{localizeWorkbenchText(ui.locale, field.label)}</dt>
                    <dd>{localizeWorkbenchText(ui.locale, field.value)}</dd>
                  </div>
                ))}
              </dl>
            </article>
            <article className="inspector-card">
              <div className="card-header">
                <h3>{t("rightDock.selection")}</h3>
              </div>
              {ui.mode === "edit" ? (
                <EditSelectionInspector
                  context={selectionContext}
                  controller={controller}
                  state={inspectorState}
                />
              ) : (
                <SimulationSelectionInspector
                  context={selectionContext}
                  controller={controller}
                  state={inspectorState}
                />
              )}
            </article>
            {ui.diagnosticsVisible ? (
              <div className="cluster">
                <div className="card-header card-subheader">
                  <h3>{t("section.diagnostics")}</h3>
                </div>
                <div className="definition-list">
                  {topology.diagnostics.length > 0 ? (
                    topology.diagnostics.map((diagnostic) => (
                      <article className="log-card" key={diagnostic.id}>
                        <h4>{diagnostic.severity.toUpperCase()}</h4>
                        <p>{diagnostic.message}</p>
                      </article>
                    ))
                  ) : (
                    <article className="definition-card">
                      <p>{t("label.noDiagnostics")}</p>
                    </article>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="dock-collapsed-body">{t("rightDock.collapsed")}</div>
        )}
      </section>
    </aside>
  );
}
