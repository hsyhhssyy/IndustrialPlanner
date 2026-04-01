import { createTranslator } from "@/i18n/messages";
import type { SelectionInspectorPanelProps } from "@/app-shell/components/inspector/selection-inspector-model";
import {
  ConnectionList,
  NoSelectionState,
  RuntimeDetailList,
  SelectionInspectorSummary,
} from "@/app-shell/components/inspector/selection-inspector-shared";

export function SimulationSelectionInspector({
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
          <h4>{t("section.runtimeDetails")}</h4>
        </div>
        <RuntimeDetailList context={context} snapshot={snapshot} />
      </div>
      <div className="cluster">
        <div className="card-header card-subheader">
          <h4>{t("section.connections")}</h4>
        </div>
        <ConnectionList
          controller={controller}
          links={context.selectedLinks}
          locale={snapshot.ui.locale}
          removeDisabled
        />
      </div>
    </div>
  );
}
