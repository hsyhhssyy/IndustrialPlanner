import type {
  WorkbenchController,
  WorkbenchSnapshot,
} from "@/app-shell/controller/workbench-controller";
import {
  RIGHT_BASE_GROUPS,
  RIGHT_BASE_SUMMARY,
  RIGHT_POWER_SUMMARY,
  localizeText,
} from "@/app-shell/workbench-placeholders";
import {
  getLocalizedMutabilityLabel,
  getLocalizedStage1ConfigFieldLabel,
  getLocalizedStage1EntityName,
} from "@/domain/registry/stage1-registry-i18n";
import { createTranslator } from "@/i18n/messages";

export interface RightDockProps {
  controller: WorkbenchController;
  snapshot: WorkbenchSnapshot;
}

function formatConfigValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).join(", ");
  }

  if (value === null || value === undefined) {
    return "—";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

export function RightDock({ controller, snapshot }: RightDockProps) {
  if (!snapshot.ui.rightDock.open) {
    return null;
  }

  const t = createTranslator(snapshot.ui.locale);

  const selectedEntityId = snapshot.session.selection[0] ?? null;
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
              {selectedEntity && selectedDefinition ? (
                <div className="stack">
                  <dl className="kv-grid">
                    <div className="kv">
                      <dt>{t("label.definition")}</dt>
                      <dd>
                        {getLocalizedStage1EntityName(
                          snapshot.ui.locale,
                          selectedDefinition,
                        )}
                      </dd>
                    </div>
                    <div className="kv">
                      <dt>{t("label.entityId")}</dt>
                      <dd>{selectedEntity.id}</dd>
                    </div>
                    <div className="kv">
                      <dt>{t("label.mode")}</dt>
                      <dd>
                        {t(
                          snapshot.ui.mode === "edit"
                            ? "mode.edit"
                            : "mode.simulate",
                        )}
                      </dd>
                    </div>
                    <div className="kv">
                      <dt>{t("label.runtime")}</dt>
                      <dd>{selectedEntityRuntime?.status ?? "idle"}</dd>
                    </div>
                    <div className="kv">
                      <dt>{t("label.position")}</dt>
                      <dd>
                        {selectedEntity.position.x}, {selectedEntity.position.y}
                      </dd>
                    </div>
                    <div className="kv">
                      <dt>{t("label.rotation")}</dt>
                      <dd>{selectedEntity.rotation}°</dd>
                    </div>
                    <div className="kv">
                      <dt>{t("label.links")}</dt>
                      <dd>{selectedLinks.length}</dd>
                    </div>
                  </dl>
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
                        disabled={selectedLinks.length === 0}
                        onClick={() => {
                          void controller.removeSelectionLinks();
                        }}
                        type="button"
                      >
                        {t("action.removeLinks")}
                      </button>
                      <button
                        onClick={() => controller.setActiveTool("link")}
                        type="button"
                      >
                        {t("tool.link")}
                      </button>
                    </div>
                  </div>
                  <div className="cluster">
                    <div className="card-header card-subheader">
                      <h4>{t("section.connections")}</h4>
                    </div>
                    <div className="definition-list">
                      {selectedLinks.length === 0 ? (
                        <article className="definition-card">
                          <p>{t("label.noConnections")}</p>
                        </article>
                      ) : (
                        selectedLinks.map((link) => (
                          <article className="definition-card" key={link.id}>
                            <h4>{link.id}</h4>
                            <p>
                              {link.sourceEntityId} → {link.targetEntityId}
                            </p>
                            <button
                              onClick={() => {
                                void controller.removeLink(link.id);
                              }}
                              type="button"
                            >
                              {t("action.removeLink")}
                            </button>
                          </article>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="cluster">
                    <div className="card-header card-subheader">
                      <h4>{t("section.configFields")}</h4>
                    </div>
                    <div className="definition-list">
                      {selectedDefinition.configFields.length === 0 ? (
                        <article className="definition-card">
                          <p>{t("label.noConfigFields")}</p>
                        </article>
                      ) : (
                        selectedDefinition.configFields.map((field) => (
                          <article className="definition-card" key={field.key}>
                            <h4>
                              {getLocalizedStage1ConfigFieldLabel(
                                snapshot.ui.locale,
                                field,
                              )}
                            </h4>
                            <p>
                              {getLocalizedMutabilityLabel(
                                snapshot.ui.locale,
                                field.mutability,
                              )}
                            </p>
                            <p>
                              {formatConfigValue(selectedEntity.config[field.key])}
                            </p>
                          </article>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="cluster">
                    <div className="card-header card-subheader">
                      <h4>{t("section.runtimeDetails")}</h4>
                    </div>
                    <div className="definition-list">
                      {(snapshot.inspectorDetails?.entityId === selectedEntity.id
                        ? snapshot.inspectorDetails.lines
                        : [t("label.runtimeDetailPlaceholder")]
                      ).map((line) => (
                        <article className="definition-card" key={line}>
                          <p>{line}</p>
                        </article>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <article className="definition-card">
                  <h4>{t("label.noSelection")}</h4>
                  <p>{t("label.runtimeDetailPlaceholder")}</p>
                </article>
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
