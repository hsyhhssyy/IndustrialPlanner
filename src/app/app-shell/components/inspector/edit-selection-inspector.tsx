import { createTranslator } from "@/i18n/messages";
import {
  formatConfigValue,
  type SelectionInspectorPanelProps,
} from "@/app/app-shell/components/inspector/selection-inspector-model";
import {
  ConfigFieldMutationControl,
  ConnectionList,
  NoSelectionState,
  RuntimeDetailList,
  SelectionInspectorSummary,
} from "@/app/app-shell/components/inspector/selection-inspector-shared";
import {
  getLocalizedMutabilityLabel,
  getLocalizedStage1ConfigFieldLabel,
} from "@/i18n/stage1-registry";

const noop = () => {};

export function EditSelectionInspector({
  state,
  context,
}: SelectionInspectorPanelProps) {
  const t = createTranslator(state.locale);

  if (!context) {
    return <NoSelectionState locale={state.locale} />;
  }

  return (
    <div className="stack">
      <SelectionInspectorSummary context={context} state={state} />
      <div className="cluster">
        <div className="card-header card-subheader">
          <h4>{t("section.quickActions")}</h4>
        </div>
        <div className="inspector-option-grid">
          <button
            onClick={noop}
            type="button"
          >
            {t("action.deleteSelection")}
          </button>
          <button
            disabled={context.selectedLinks.length === 0}
            onClick={noop}
            type="button"
          >
            {t("action.removeLinks")}
          </button>
          <button
            onClick={noop}
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
        <ConnectionList
          links={context.selectedLinks}
          locale={state.locale}
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
                  {getLocalizedStage1ConfigFieldLabel(state.locale, field)}
                </h4>
                <p>
                  {getLocalizedMutabilityLabel(
                    state.locale,
                    field.mutability,
                  )}
                </p>
                <p>
                  {formatConfigValue(context.selectedEntity.config[field.key])}
                </p>
                <ConfigFieldMutationControl
                  clearLabel={t("action.clearPatch")}
                  currentValue={context.selectedEntity.config[field.key]}
                  locale={state.locale}
                  onApply={noop}
                  submitLabel={t("action.applyValue")}
                  toggleLabel={t("action.toggleValue")}
                />
              </article>
            ))
          )}
        </div>
      </div>
      <div className="cluster">
        <div className="card-header card-subheader">
          <h4>{t("section.runtimeDetails")}</h4>
        </div>
        <RuntimeDetailList state={state} />
      </div>
    </div>
  );
}
