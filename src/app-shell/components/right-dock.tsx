import { EditSelectionInspector } from "@/app-shell/components/inspector/edit-selection-inspector";
import type { SelectionInspectorContext } from "@/app-shell/components/inspector/selection-inspector-model";
import { SimulationSelectionInspector } from "@/app-shell/components/inspector/simulation-selection-inspector";
import { useExternalStore } from "@/app-shell/hooks/use-external-store";
import {
  RIGHT_POWER_SUMMARY,
} from "@/app-shell/workbench-placeholders";
import {
  STAGE1_BASE_DEFINITIONS,
  formatStage1BaseArea,
  formatStage1BaseExpansion,
  getStage1BaseDefinition,
  getStage1BaseGroupOrder,
} from "@/domain/base/stage1-bases";
import { createTranslator } from "@/i18n/messages";
import { getLocalizedStage1EntityName } from "@/i18n/stage1-registry";
import { localizeWorkbenchText } from "@/i18n/workbench-placeholders";
import { observer } from "@/shared/mobx";
import type { WorkbenchController } from "@/workbench/contracts/workbench-facade";

export interface RightDockProps {
  controller: WorkbenchController;
}

function formatMultiSelectionLabel(locale: "zh-CN" | "en-US", count: number): string {
  return locale === "zh-CN" ? `已选中 ${count} 个对象` : `${count} selected`;
}

export const RightDock = observer(function RightDock({
  controller,
}: RightDockProps) {
  const ui = controller.uiStore;
  const document = useExternalStore(controller.documentStore);
  const editor = controller.editorStore;
  const topology = useExternalStore(controller.topologyStore);
  const simulation = useExternalStore(controller.simulationStore);

  if (!ui.rightDock.open) {
    return null;
  }

  const t = createTranslator(ui.locale);
  const activeSelection =
    ui.phase === "simulate" ? simulation.selection : editor.session.selection;
  const hasSingleSelection = activeSelection.length === 1;
  const hasMultiSelection = activeSelection.length > 1;

  const selectedEntityId =
    hasSingleSelection ? activeSelection[0] ?? null : null;
  const selectedEntity = selectedEntityId
    ? document.entities[selectedEntityId]
    : null;
  const selectedDefinition = selectedEntityId
    ? topology.entityViews[selectedEntityId]?.definition ?? null
    : null;
  const selectedEntityRuntime = selectedEntityId
    ? simulation.runtimeSnapshot.entityViews[selectedEntityId]
    : null;
  const selectedLinks = selectedEntityId
    ? document.explicitLinks.filter(
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
    phase: ui.phase,
    inspectorDetails: simulation.inspectorDetails,
    simulationPatchSet: simulation.patchSet,
  } as const;
  const activeBase = getStage1BaseDefinition(document.baseId);
  const baseGroups = getStage1BaseGroupOrder().map((groupId) => {
    const groupBases = STAGE1_BASE_DEFINITIONS.filter(
      (base) => base.groupId === groupId,
    );

    return {
      id: groupId,
      title: groupBases[0]?.groupLabel[ui.locale] ?? groupId,
      options: groupBases,
    };
  });

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
                {baseGroups.map((group) => (
                  <div className="cluster" key={group.id}>
                    <h4 className="inspector-group-title">
                      {group.title}
                    </h4>
                    <div className="inspector-option-grid">
                      {group.options.map((option) => (
                        <button
                          className={option.id === document.baseId ? "is-active" : undefined}
                          key={option.id}
                          onClick={() => undefined}
                          type="button"
                        >
                          {option.name[ui.locale]}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <dl className="inspector-summary-list">
                  <div className="inspector-summary-row">
                    <dt>{localizeWorkbenchText(ui.locale, { messageKey: "workbench.summary.buildableArea", fallback: "Buildable Area" })}</dt>
                    <dd>{formatStage1BaseArea(activeBase)}</dd>
                  </div>
                  <div className="inspector-summary-row">
                    <dt>{localizeWorkbenchText(ui.locale, { messageKey: "workbench.summary.expansion", fallback: "Expansion" })}</dt>
                    <dd>{formatStage1BaseExpansion(activeBase)}</dd>
                  </div>
                  <div className="inspector-summary-row">
                    <dt>{localizeWorkbenchText(ui.locale, { messageKey: "workbench.summary.baseTag", fallback: "Base Tag" })}</dt>
                    <dd>{activeBase.groupLabel[ui.locale]}</dd>
                  </div>
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
              {hasMultiSelection ? (
                <div className="stack">
                  <article className="definition-card">
                    <h4>{formatMultiSelectionLabel(ui.locale, activeSelection.length)}</h4>
                    <p>{t("label.multiSelectionSummary")}</p>
                  </article>
                  {ui.phase === "edit" ? (
                    <div className="cluster">
                      <div className="card-header card-subheader">
                        <h4>{t("section.quickActions")}</h4>
                      </div>
                      <div className="inspector-option-grid">
                        <button
                          onClick={() => {
                            void controller.removeSelection();
                          }}
                          type="button"
                        >
                          {t("action.deleteSelection")}
                        </button>
                        <button
                          onClick={() => {
                            void controller.removeSelectionLinks();
                          }}
                          type="button"
                        >
                          {t("action.removeLinks")}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : ui.phase === "edit" ? (
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
});
