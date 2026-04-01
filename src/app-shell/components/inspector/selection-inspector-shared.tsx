import type {
  WorkbenchController,
  WorkbenchSnapshot,
} from "@/app-shell/controller/workbench-controller";
import {
  getLocalizedStage1EntityName,
} from "@/domain/registry/stage1-registry-i18n";
import type {
  ExplicitLink,
} from "@/domain/document/world-document";
import type { AppLocale } from "@/i18n/messages";
import { createTranslator } from "@/i18n/messages";
import type {
  SelectionInspectorContext,
} from "@/app-shell/components/inspector/selection-inspector-model";

export function SelectionInspectorSummary({
  snapshot,
  context,
}: {
  snapshot: WorkbenchSnapshot;
  context: SelectionInspectorContext;
}) {
  const t = createTranslator(snapshot.ui.locale);

  return (
    <dl className="kv-grid">
      <div className="kv">
        <dt>{t("label.definition")}</dt>
        <dd>
          {getLocalizedStage1EntityName(
            snapshot.ui.locale,
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
        <dd>
          {t(snapshot.ui.mode === "edit" ? "mode.edit" : "mode.simulate")}
        </dd>
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
  snapshot,
  context,
}: {
  snapshot: WorkbenchSnapshot;
  context: SelectionInspectorContext;
}) {
  const t = createTranslator(snapshot.ui.locale);
  const lines =
    snapshot.inspectorDetails?.entityId === context.selectedEntity.id
      ? snapshot.inspectorDetails.lines
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
