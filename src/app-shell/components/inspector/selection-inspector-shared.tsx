import type {
  WorkbenchController,
} from "@/workbench/contracts/workbench-facade";
import type {
  ExplicitLink,
} from "@/domain/document/world-document";
import type { AppLocale } from "@/i18n/messages";
import { createTranslator } from "@/i18n/messages";
import { getLocalizedStage1EntityName } from "@/i18n/stage1-registry";
import type {
  SelectionInspectorContext,
  SelectionInspectorState,
} from "@/app-shell/components/inspector/selection-inspector-model";
import {
  parseConfigInputValue,
  serializeConfigValueForInput,
} from "@/app-shell/components/inspector/selection-inspector-model";

export function SelectionInspectorSummary({
  state,
  context,
}: {
  state: SelectionInspectorState;
  context: SelectionInspectorContext;
}) {
  const t = createTranslator(state.locale);

  return (
    <dl className="kv-grid">
      <div className="kv">
        <dt>{t("label.definition")}</dt>
        <dd>
          {getLocalizedStage1EntityName(
            state.locale,
            context.selectedDefinition,
          )}
        </dd>
      </div>
      <div className="kv">
        <dt>{t("label.entityId")}</dt>
        <dd>{context.selectedEntity.id}</dd>
      </div>
      <div className="kv">
        <dt>{t("label.mode")}</dt>
        <dd>{t(state.phase === "edit" ? "mode.edit" : "mode.simulate")}</dd>
      </div>
      <div className="kv">
        <dt>{t("label.runtime")}</dt>
        <dd>{context.selectedEntityRuntime?.status ?? "idle"}</dd>
      </div>
      <div className="kv">
        <dt>{t("label.position")}</dt>
        <dd>
          {context.selectedEntity.position.x}, {context.selectedEntity.position.y}
        </dd>
      </div>
      <div className="kv">
        <dt>{t("label.rotation")}</dt>
        <dd>{context.selectedEntity.rotation}°</dd>
      </div>
      <div className="kv">
        <dt>{t("label.links")}</dt>
        <dd>{context.selectedLinks.length}</dd>
      </div>
    </dl>
  );
}

export function ConnectionList({
  controller,
  locale,
  links,
  removeDisabled,
}: {
  controller: WorkbenchController;
  locale: AppLocale;
  links: ExplicitLink[];
  removeDisabled: boolean;
}) {
  const t = createTranslator(locale);

  return (
    <div className="definition-list">
      {links.length === 0 ? (
        <article className="definition-card">
          <p>{t("label.noConnections")}</p>
        </article>
      ) : (
        links.map((link) => (
          <article className="definition-card" key={link.id}>
            <h4>{link.id}</h4>
            <p>
              {link.sourceEntityId} → {link.targetEntityId}
            </p>
            <button
              disabled={removeDisabled}
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
  );
}

export function RuntimeDetailList({
  state,
  context,
}: {
  state: SelectionInspectorState;
  context: SelectionInspectorContext;
}) {
  const t = createTranslator(state.locale);
  const lines =
    state.inspectorDetails?.entityId === context.selectedEntity.id
      ? state.inspectorDetails.lines
      : [t("label.runtimeDetailPlaceholder")];

  return (
    <div className="definition-list">
      {lines.map((line) => (
        <article className="definition-card" key={line}>
          <p>{line}</p>
        </article>
      ))}
    </div>
  );
}

export function NoSelectionState({ locale }: { locale: AppLocale }) {
  const t = createTranslator(locale);

  return (
    <article className="definition-card">
      <h4>{t("label.noSelection")}</h4>
      <p>{t("label.runtimeDetailPlaceholder")}</p>
    </article>
  );
}

export function ConfigFieldMutationControl({
  currentValue,
  locale,
  submitLabel,
  toggleLabel,
  clearLabel,
  disabled = false,
  onApply,
  onClear,
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
  const t = createTranslator(locale);

  if (typeof currentValue === "boolean") {
    return (
      <div className="inspector-option-grid">
        <button
          disabled={disabled}
          onClick={() => {
            void onApply(!currentValue);
          }}
          type="button"
        >
          {toggleLabel}: {currentValue ? t("action.close") : t("action.open")}
        </button>
        {onClear ? (
          <button
            disabled={disabled}
            onClick={() => {
              void onClear();
            }}
            type="button"
          >
            {clearLabel}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <form
      className="cluster"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const rawValue = String(formData.get("nextValue") ?? "");
        void onApply(parseConfigInputValue(rawValue, currentValue));
      }}
    >
      <input
        defaultValue={serializeConfigValueForInput(currentValue)}
        disabled={disabled}
        name="nextValue"
      />
      <button disabled={disabled} type="submit">
        {submitLabel}
      </button>
      {onClear ? (
        <button
          disabled={disabled}
          onClick={() => {
            void onClear();
          }}
          type="button"
        >
          {clearLabel}
        </button>
      ) : null}
    </form>
  );
}
