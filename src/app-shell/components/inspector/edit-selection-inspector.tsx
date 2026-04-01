import { createTranslator } from "@/i18n/messages";
import {
  getLocalizedMutabilityLabel,
  getLocalizedStage1ConfigFieldLabel,
} from "@/domain/registry/stage1-registry-i18n";
import {
  formatConfigValue,
  type SelectionInspectorPanelProps,
} from "@/app-shell/components/inspector/selection-inspector-model";
import {
  ConnectionList,
  NoSelectionState,
  RuntimeDetailList,
  SelectionInspectorSummary,
} from "@/app-shell/components/inspector/selection-inspector-shared";

export function EditSelectionInspector({
  controller,
  snapshot,
  context,
}: SelectionInspectorPanelProps) {
  const t = createTranslator(snapshot.ui.locale);

  if (!context) {
    return <NoSelectionState locale={snapshot.ui.locale} />;
  }

  return (
    <div className="stack">
      <SelectionInspectorSummary context={context} snapshot={snapshot} />
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
            disabled={context.selectedLinks.length === 0}
            onClick={() => {
              void controller.removeSelectionLinks();
            }}
            type="button"
          >
            {t("action.removeLinks")}
          </button>
          <button onClick={() => controller.setActiveTool("link")} type="button">
            {t("tool.link")}
          </button>
        </div>
      </div>
      <div className="cluster">
        <div className="card-header card-subheader">
          <h4>{t("section.connections")}</h4>
        </div>
        <ConnectionList
          controller={controller}
          links={context.selectedLinks}
          locale={snapshot.ui.locale}
          removeDisabled={false}
        />
      </div>
      <div className="cluster">
        <div className="card-header card-subheader">
          <h4>{t("section.configFields")}</h4>
        </div>
        <div className="definition-list">
          {context.selectedDefinition.configFields.length === 0 ? (
            <article className="definition-card">
              <p>{t("label.noConfigFields")}</p>
            </article>
          ) : (
            context.selectedDefinition.configFields.map((field) => (
              <article className="definition-card" key={field.key}>
                <h4>
                  {getLocalizedStage1ConfigFieldLabel(snapshot.ui.locale, field)}
                </h4>
                <p>
                  {getLocalizedMutabilityLabel(
                    snapshot.ui.locale,
                    field.mutability,
                  )}
                </p>
                <p>
                  {formatConfigValue(context.selectedEntity.config[field.key])}
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
        <RuntimeDetailList context={context} snapshot={snapshot} />
      </div>
    </div>
  );
}
