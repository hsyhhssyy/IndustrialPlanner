import type { SelectionInspectorPanelProps } from "@/app/app-shell/components/inspector/selection-inspector-model";
import {
  ConfigFieldMutationControl,
  ConnectionList,
  NoSelectionState,
  RuntimeDetailList,
} from "@/app/app-shell/components/inspector/selection-inspector-shared";
import {
  STATIC_UI_PLACEHOLDER_TEXT,
  handleUiEvent,
} from "@/app/app-shell/components/ui-shell-null-handlers";

export function EditSelectionInspector({
  controller: _controller,
  state: _state,
  context: _context,
}: SelectionInspectorPanelProps) {
  return (
    <div className="stack">
      <NoSelectionState locale="zh-CN" />
      <div className="cluster">
        <div className="card-header card-subheader">
          <h4>{STATIC_UI_PLACEHOLDER_TEXT}</h4>
        </div>
        <div className="inspector-option-grid">
          <button onClick={handleUiEvent} type="button">
            {STATIC_UI_PLACEHOLDER_TEXT}
          </button>
          <button onClick={handleUiEvent} type="button">
            {STATIC_UI_PLACEHOLDER_TEXT}
          </button>
          <button onClick={handleUiEvent} type="button">
            {STATIC_UI_PLACEHOLDER_TEXT}
          </button>
        </div>
      </div>
      <div className="cluster">
        <div className="card-header card-subheader">
          <h4>{STATIC_UI_PLACEHOLDER_TEXT}</h4>
        </div>
        <ConnectionList
          links={[]}
          locale="zh-CN"
          removeDisabled={false}
        />
      </div>
      <div className="cluster">
        <div className="card-header card-subheader">
          <h4>{STATIC_UI_PLACEHOLDER_TEXT}</h4>
        </div>
        <div className="definition-list">
          <article className="definition-card">
            <h4>{STATIC_UI_PLACEHOLDER_TEXT}</h4>
            <p>{STATIC_UI_PLACEHOLDER_TEXT}</p>
            <p>{STATIC_UI_PLACEHOLDER_TEXT}</p>
            <ConfigFieldMutationControl
              clearLabel={STATIC_UI_PLACEHOLDER_TEXT}
              currentValue={STATIC_UI_PLACEHOLDER_TEXT}
              locale="zh-CN"
              onApply={handleUiEvent}
              submitLabel={STATIC_UI_PLACEHOLDER_TEXT}
              toggleLabel={STATIC_UI_PLACEHOLDER_TEXT}
            />
          </article>
        </div>
      </div>
      <div className="cluster">
        <div className="card-header card-subheader">
          <h4>{STATIC_UI_PLACEHOLDER_TEXT}</h4>
        </div>
        <RuntimeDetailList state={{ locale: "zh-CN" }} />
      </div>
    </div>
  );
}
