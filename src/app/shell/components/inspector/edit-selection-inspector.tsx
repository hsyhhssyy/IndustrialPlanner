import type { AppHost } from "@/app/host/app-host";
import type { SelectionInspectorPanelProps } from "@/app/shell/components/inspector/selection-inspector-model";
import { SelectionInspectorSlot } from "@/app/shell/components/inspector/selection-inspector-slot";
import {
  ConfigFieldMutationControl,
  ConnectionList,
  NoSelectionState,
} from "@/app/shell/components/inspector/selection-inspector-shared";
import {
  handleUiEvent,
} from "@/app/shell/components/ui-shell-null-handlers";

const QUICK_ACTION_KEYS = [
  "action.deleteSelection",
  "action.rotateSelection",
  "action.removeLinks",
] as const;

export function EditSelectionInspector({
  appHost,
  state,
  context: _context,
  translate,
}: SelectionInspectorPanelProps & {
  appHost: AppHost;
  translate: (key: string) => string;
}) {
  const locale = state.locale;

  return (
    <div className="stack">
      <NoSelectionState locale={locale} translate={translate} />
      <div className="cluster">
        <div className="card-header card-subheader">
          <h4>{translate("section.quickActions")}</h4>
        </div>
        <div className="inspector-option-grid">
          {QUICK_ACTION_KEYS.map((key) => (
            <button key={key} onClick={handleUiEvent} type="button">
              {translate(key)}
            </button>
          ))}
        </div>
      </div>
      <div className="cluster">
        <div className="card-header card-subheader">
          <h4>{translate("section.connections")}</h4>
        </div>
        <ConnectionList
          links={[]}
          locale={locale}
          removeDisabled={false}
          translate={translate}
        />
      </div>
      <div className="cluster">
        <div className="card-header card-subheader">
          <h4>{translate("section.configFields")}</h4>
        </div>
        <div className="definition-list">
          <article className="definition-card">
            <h4>{translate("label.runtimePatch")}</h4>
            <p>{translate("label.runtimePatchDisabled")}</p>
            <p>{translate("label.runtimePatchClearsOnExit")}</p>
            <ConfigFieldMutationControl
              clearLabel={translate("action.clearPatch")}
              currentValue={translate("label.runtimePatchNone")}
              locale={locale}
              onApply={handleUiEvent}
              submitLabel={translate("action.applyValue")}
              toggleLabel={translate("action.toggleValue")}
            />
          </article>
        </div>
      </div>
      <SelectionInspectorSlot appHost={appHost} translate={translate} />
    </div>
  );
}
