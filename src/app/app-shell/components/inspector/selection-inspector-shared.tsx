import type {
  ExplicitLink,
} from "@/domain/document/world-document";
import type { AppLocale } from "@/i18n/messages";
import type {
  SelectionInspectorContext,
  SelectionInspectorState,
} from "@/app/app-shell/components/inspector/selection-inspector-model";
import {
  STATIC_UI_PLACEHOLDER_TEXT,
  handleUiEvent,
} from "@/app/app-shell/components/ui-shell-null-handlers";

export function SelectionInspectorSummary({
  state: _state,
  context: _context,
}: {
  state: SelectionInspectorState;
  context: SelectionInspectorContext;
}) {
  return (
    <dl className="kv-grid">
      <div className="kv">
        <dt>{STATIC_UI_PLACEHOLDER_TEXT}</dt>
        <dd>{STATIC_UI_PLACEHOLDER_TEXT}</dd>
      </div>
      <div className="kv">
        <dt>{STATIC_UI_PLACEHOLDER_TEXT}</dt>
        <dd>{STATIC_UI_PLACEHOLDER_TEXT}</dd>
      </div>
      <div className="kv">
        <dt>{STATIC_UI_PLACEHOLDER_TEXT}</dt>
        <dd>{STATIC_UI_PLACEHOLDER_TEXT}</dd>
      </div>
      <div className="kv">
        <dt>{STATIC_UI_PLACEHOLDER_TEXT}</dt>
        <dd>{STATIC_UI_PLACEHOLDER_TEXT}</dd>
      </div>
      <div className="kv">
        <dt>{STATIC_UI_PLACEHOLDER_TEXT}</dt>
        <dd>{STATIC_UI_PLACEHOLDER_TEXT}</dd>
      </div>
      <div className="kv">
        <dt>{STATIC_UI_PLACEHOLDER_TEXT}</dt>
        <dd>{STATIC_UI_PLACEHOLDER_TEXT}</dd>
      </div>
    </dl>
  );
}

export function ConnectionList({
  locale: _locale,
  links: _links,
  removeDisabled: _removeDisabled,
}: {
  locale: AppLocale;
  links: ExplicitLink[];
  removeDisabled: boolean;
}) {
  return (
    <div className="definition-list">
      <article className="definition-card">
        <h4>{STATIC_UI_PLACEHOLDER_TEXT}</h4>
        <p>{STATIC_UI_PLACEHOLDER_TEXT}</p>
        <button onClick={handleUiEvent} type="button">
          {STATIC_UI_PLACEHOLDER_TEXT}
        </button>
      </article>
    </div>
  );
}

export function RuntimeDetailList({
  state: _state,
}: {
  state: SelectionInspectorState;
}) {
  return (
    <div className="definition-list">
      <article className="definition-card">
        <p>{STATIC_UI_PLACEHOLDER_TEXT}</p>
      </article>
    </div>
  );
}

export function NoSelectionState({ locale: _locale }: { locale: AppLocale }) {
  return (
    <article className="definition-card">
      <h4>{STATIC_UI_PLACEHOLDER_TEXT}</h4>
      <p>{STATIC_UI_PLACEHOLDER_TEXT}</p>
    </article>
  );
}

export function ConfigFieldMutationControl({
  currentValue: _currentValue,
  locale: _locale,
  submitLabel: _submitLabel,
  toggleLabel: _toggleLabel,
  clearLabel: _clearLabel,
  disabled: _disabled = false,
  onApply: _onApply,
  onClear: _onClear,
}: {
  currentValue: unknown;
  locale: AppLocale;
  submitLabel: string;
  toggleLabel: string;
  clearLabel?: string;
  disabled?: boolean;
  onApply: (value: unknown) => Promise<void> | void;
  onClear?: () => Promise<void> | void;
}) {
  return (
    <div className="cluster">
      <input
        defaultValue={STATIC_UI_PLACEHOLDER_TEXT}
        name="nextValue"
        onChange={handleUiEvent}
      />
      <button onClick={handleUiEvent} type="button">
        {STATIC_UI_PLACEHOLDER_TEXT}
      </button>
      <button onClick={handleUiEvent} type="button">
        {STATIC_UI_PLACEHOLDER_TEXT}
      </button>
    </div>
  );
}
