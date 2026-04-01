import type {
  WorkbenchController,
  WorkbenchSnapshot,
} from "@/app-shell/controller/workbench-controller";
import { EditSelectionInspector } from "@/app-shell/components/inspector/edit-selection-inspector";
import type { SelectionInspectorContext } from "@/app-shell/components/inspector/selection-inspector-model";
import { SimulationSelectionInspector } from "@/app-shell/components/inspector/simulation-selection-inspector";
import {
  RIGHT_BASE_GROUPS,
  RIGHT_BASE_SUMMARY,
  RIGHT_POWER_SUMMARY,
  localizeText,
} from "@/app-shell/workbench-placeholders";
import {
  getLocalizedStage1EntityName,
} from "@/domain/registry/stage1-registry-i18n";
import { createTranslator } from "@/i18n/messages";

export interface RightDockProps {
  controller: WorkbenchController;
  snapshot: WorkbenchSnapshot;
}

export function RightDock({ controller, snapshot }: RightDockProps) {
  if (!snapshot.ui.rightDock.open) {
    return null;
  }

  const t = createTranslator(snapshot.ui.locale);

  const selectedEntityId = snapshot.activeCanvas.selectedEntityIds[0] ?? null;
  const selectedEntity = selectedEntityId
    ? snapshot.document.entities[selectedEntityId]
    : null;
  const selectedDefinition = selectedEntityId
    ? snapshot.topology.entityViews[selectedEntityId]?.definition ?? null
    : null;
  const selectedEntityRuntime = selectedEntityId
    ? snapshot.runtimeSnapshot.entityViews[selectedEntityId]
    : null;
  const selectedLinks = selectedEntityId
    ? snapshot.document.explicitLinks.filter(
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

  return (
    <aside className="dock dock-right panel-surface">
      <section className="dock-section">
        <div className="section-header">
          <h2>{t("rightDock.title")}</h2>
          <div className="header-actions">
            <span className="pill">
              {selectedDefinition
                ? getLocalizedStage1EntityName(snapshot.ui.locale, selectedDefinition)
                : t("label.noSelection")}
            </span>
            <button
              onClick={() => controller.toggleDockCollapsed("right")}
              type="button"
            >
              {t(
                snapshot.ui.rightDock.collapsed
                  ? "action.expand"
                  : "action.collapse",
              )}
            </button>
          </div>
        </div>
        {!snapshot.ui.rightDock.collapsed ? (
          <div className="section-body stack">
            <article className="inspector-card">
              <div className="card-header">
                <h3>{t("rightDock.base")}</h3>
              </div>
              <div className="stack">
                {RIGHT_BASE_GROUPS.map((group) => (
                  <div className="cluster" key={localizeText(snapshot.ui.locale, group.title)}>
                    <h4 className="inspector-group-title">
                      {localizeText(snapshot.ui.locale, group.title)}
                    </h4>
                    <div className="inspector-option-grid">
                      {group.options.map((option) => (
                        <button
                          className={option.active ? "is-active" : undefined}
                          key={option.id}
                          onClick={() => undefined}
                          type="button"
                        >
                          {localizeText(snapshot.ui.locale, option.label)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <dl className="inspector-summary-list">
                  {RIGHT_BASE_SUMMARY.map((field) => (
                    <div className="inspector-summary-row" key={field.id}>
                      <dt>{localizeText(snapshot.ui.locale, field.label)}</dt>
                      <dd>{localizeText(snapshot.ui.locale, field.value)}</dd>
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
                    <dt>{localizeText(snapshot.ui.locale, field.label)}</dt>
                    <dd>{localizeText(snapshot.ui.locale, field.value)}</dd>
                  </div>
                ))}
              </dl>
            </article>
            <article className="inspector-card">
              <div className="card-header">
                <h3>{t("rightDock.selection")}</h3>
              </div>
              {snapshot.ui.mode === "edit" ? (
                <EditSelectionInspector
                  context={selectionContext}
                  controller={controller}
                  snapshot={snapshot}
                />
              ) : (
                <SimulationSelectionInspector
                  context={selectionContext}
                  controller={controller}
                  snapshot={snapshot}
                />
              )}
            </article>
            {snapshot.ui.diagnosticsVisible ? (
              <div className="cluster">
                <div className="card-header card-subheader">
                  <h3>{t("section.diagnostics")}</h3>
                </div>
                <div className="definition-list">
                  {snapshot.topology.diagnostics.length > 0 ? (
                    snapshot.topology.diagnostics.map((diagnostic) => (
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
