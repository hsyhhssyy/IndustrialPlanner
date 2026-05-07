import { observer } from "mobx-react-lite";
import type { AppHost } from "@/app/host/app-host";
import { SelectionInspectorActionStrip } from "@/app/shell/inspector/selection-inspector-action-strip";
import type { SelectionInspectorPanelProps } from "@/app/shell/inspector/selection-inspector-model";
import { SelectionInspectorSlot } from "@/app/shell/inspector/selection-inspector-slot";
import {
  NoSelectionState,
} from "@/app/shell/inspector/selection-inspector-shared";

export const EditSelectionInspector = observer(function EditSelectionInspector({
  appHost,
  state,
  context: _context,
  translate,
}: SelectionInspectorPanelProps & {
  appHost: AppHost;
  translate: (key: string) => string;
}) {
  const locale = state.locale;
  const selectionCount = appHost.workspace.editor?.state.collections.selection.length ?? 0;

  if (selectionCount === 0) {
    return <NoSelectionState locale={locale} translate={translate} />;
  }

  if (selectionCount > 1) {
    return (
      <div className="cluster">
        <SelectionInspectorActionStrip appHost={appHost} />
        <article className="definition-card">
          <p>{translate("label.multiSelectionSummary")}</p>
        </article>
      </div>
    );
  }

  return (
    <div className="cluster">
      <SelectionInspectorActionStrip appHost={appHost} />
      <SelectionInspectorSlot appHost={appHost} translate={translate} />
    </div>
  );
});
