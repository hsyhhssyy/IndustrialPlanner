import { createTranslator } from "@/i18n/messages";
import {
  formatConfigValue,
  type SelectionInspectorPanelProps,
} from "@/app-shell/components/inspector/selection-inspector-model";
import {
  ConfigFieldMutationControl,
  ConnectionList,
  NoSelectionState,
  RuntimeDetailList,
  SelectionInspectorSummary,
} from "@/app-shell/components/inspector/selection-inspector-shared";
import {
  getLocalizedMutabilityLabel,
  getLocalizedStage1ConfigFieldLabel,
} from "@/i18n/stage1-registry";

export function SimulationSelectionInspector({
  controller,
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
          <h4>{t("section.runtimePatch")}</h4>
        </div>
        <div className="definition-list">
          {context.selectedDefinition.configFields.length === 0 ? (
            <article className="definition-card">
              <p>{t("label.noConfigFields")}</p>
            </article>
          ) : (
            context.selectedDefinition.configFields.map((field) => {
              const entityPatch =
                state.simulationPatchSet.entityConfigByEntityId[
                  context.selectedEntity.id
                ] ?? {};
              const hasPatch = Object.prototype.hasOwnProperty.call(
                entityPatch,
                field.key,
              );
              const patchValue = entityPatch[field.key];
              const baseValue = context.selectedEntity.config[field.key];
              const effectiveValue = hasPatch ? patchValue : baseValue;
              const runtimePatchEditable =
                field.mutability === "runtime-mutable";

              return (
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
                    {t("label.documentValue")}: {formatConfigValue(baseValue)}
                  </p>
                  <p>
                    {t("label.effectiveValue")}:{" "}
                    {formatConfigValue(effectiveValue)}
                  </p>
                  <p>
                    {t("label.runtimePatch")}:{" "}
                    {hasPatch
                      ? formatConfigValue(patchValue)
                      : t("label.runtimePatchNone")}
                  </p>
                  {runtimePatchEditable ? (
                    <ConfigFieldMutationControl
                      clearLabel={t("action.clearPatch")}
                      currentValue={effectiveValue}
                      locale={state.locale}
                      onApply={(value) =>
                        controller.patchSimulationEntityConfig(
                          context.selectedEntity.id,
                          {
                            [field.key]: value,
                          },
                        )
                      }
                      onClear={
                        hasPatch
                          ? () =>
                              controller.patchSimulationEntityConfig(
                                context.selectedEntity.id,
                                {
                                  [field.key]: undefined,
                                },
                              )
                          : undefined
                      }
                      submitLabel={t("action.applyValue")}
                      toggleLabel={t("action.toggleValue")}
                    />
                  ) : (
                    <p>{t("label.runtimePatchDisabled")}</p>
                  )}
                </article>
              );
            })
          )}
        </div>
        <p>{t("label.runtimePatchClearsOnExit")}</p>
      </div>
      <div className="cluster">
        <div className="card-header card-subheader">
          <h4>{t("section.runtimeDetails")}</h4>
        </div>
        <RuntimeDetailList context={context} state={state} />
      </div>
      <div className="cluster">
        <div className="card-header card-subheader">
          <h4>{t("section.connections")}</h4>
        </div>
        <ConnectionList
          controller={controller}
          links={context.selectedLinks}
          locale={state.locale}
          removeDisabled
        />
      </div>
    </div>
  );
}
