import type {
  ExplicitLink,
} from "@/domain/entity/world-document";
import type { AppLocale } from "@/shared/i18n/messages";
import type {
  SelectionInspectorContext,
  SelectionInspectorState,
} from "@/app/shell/components/inspector/selection-inspector-model";
import {
  serializeConfigValueForInput,
} from "@/app/shell/components/inspector/selection-inspector-model";
import {
  handleUiEvent,
} from "@/app/shell/components/ui-shell-null-handlers";

type Translate = (key: string) => string;

function resolveDefinitionLabel(
  translate: Translate,
  nameKey: string,
  fallback: string,
): string {
  const translated = translate(nameKey);

  return translated === nameKey ? fallback : translated;
}

export function SelectionInspectorSummary({
  context,
  translate,
}: {
  state: SelectionInspectorState;
  context: SelectionInspectorContext;
  translate: Translate;
}) {
  const rows = [
    {
      label: translate("label.definition"),
      value: resolveDefinitionLabel(
        translate,
        context.selectedDefinition.nameKey,
        context.selectedDefinition.id,
      ),
    },
    {
      label: translate("label.entityId"),
      value: context.selectedEntityId,
    },
    {
      label: translate("label.mode"),
      value: translate("mode.edit"),
    },
    {
      label: translate("label.position"),
      value: `${context.selectedEntity.position.x}, ${context.selectedEntity.position.y}`,
    },
    {
      label: translate("label.rotation"),
      value: String(context.selectedEntity.rotation),
    },
    {
      label: translate("label.links"),
      value: String(context.selectedLinks.length),
    },
  ];

  return (
    <dl className="kv-grid">
      {rows.map((row) => (
        <div className="kv" key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ConnectionList({
  locale: _locale,
  links,
  removeDisabled,
  translate,
}: {
  locale: AppLocale;
  links: ExplicitLink[];
  removeDisabled: boolean;
  translate: Translate;
}) {
  const removeLabel = links.length > 1
    ? translate("action.removeLinks")
    : translate("action.removeLink");

  return (
    <div className="definition-list">
      {links.length === 0 ? (
        <article className="definition-card">
          <h4>{translate("label.links")}</h4>
          <p>{translate("label.noConnections")}</p>
          <button disabled onClick={handleUiEvent} type="button">
            {translate("action.removeLinks")}
          </button>
        </article>
      ) : (
        <>
          {links.map((link, index) => (
            <article className="definition-card" key={link.id}>
              <h4>{`${translate("label.links")} #${index + 1}`}</h4>
              <p>{`${link.sourceEntityId} -> ${link.targetEntityId}`}</p>
              <p>{link.kind}</p>
            </article>
          ))}
          <button
            disabled={removeDisabled}
            onClick={handleUiEvent}
            type="button"
          >
            {removeLabel}
          </button>
        </>
      )}
    </div>
  );
}

export function RuntimeDetailList({
  state: _state,
  translate,
}: {
  state: SelectionInspectorState;
  translate: Translate;
}) {
  return (
    <div className="definition-list">
      <article className="definition-card">
        <p>{translate("label.runtimeDetailPlaceholder")}</p>
      </article>
    </div>
  );
}

export function NoSelectionState({
  locale: _locale,
  translate,
}: {
  locale: AppLocale;
  translate: Translate;
}) {
  return (
    <article className="definition-card">
      <h4>{translate("label.noSelection")}</h4>
      <p>{translate("status.edit")}</p>
    </article>
  );
}

export function ConfigFieldMutationControl({
  currentValue,
  locale: _locale,
  submitLabel,
  toggleLabel,
  clearLabel,
  disabled = false,
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
        defaultValue={serializeConfigValueForInput(currentValue)}
        disabled={disabled}
        name="nextValue"
        onChange={handleUiEvent}
      />
      <button disabled={disabled} onClick={handleUiEvent} type="button">
        {submitLabel}
      </button>
      <button disabled={disabled} onClick={handleUiEvent} type="button">
        {toggleLabel}
      </button>
      {clearLabel ? (
        <button disabled={disabled} onClick={handleUiEvent} type="button">
          {clearLabel}
        </button>
      ) : null}
    </div>
  );
}
