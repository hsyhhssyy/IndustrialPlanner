import type { BlueprintLibraryRecord } from "@/shared/blueprints/blueprint-library";

interface BlueprintDetailCardProps {
  readonly translate: (key: string) => string;
  readonly record: BlueprintLibraryRecord;
}

export function BlueprintDetailCard({
  translate,
  record,
}: BlueprintDetailCardProps) {
  return (
    <section className="placeholder-section blueprint-detail-card">
      <div className="placeholder-section-header">
        <h3>{translate("workbench.blueprint.detailsTitle")}</h3>
        <span className="pill">{record.version}</span>
      </div>
      <div className="blueprint-entry-copy">
        <span className="blueprint-entry-title">{record.name}</span>
        <span className="blueprint-entry-description">
          {record.description.length > 0
            ? record.description
            : translate("workbench.blueprint.noDescription")}
        </span>
      </div>
      <dl className="blueprint-detail-grid">
        <dt>{translate("workbench.blueprint.detailsVersion")}</dt>
        <dd>{record.version}</dd>
        <dt>{translate("workbench.blueprint.detailsBase")}</dt>
        <dd>{record.baseId}</dd>
        <dt>{translate("workbench.blueprint.detailsEntities")}</dt>
        <dd>{record.entityOrder.length}</dd>
        <dt>{translate("workbench.blueprint.detailsLinks")}</dt>
        <dd>{record.slotLinks.length}</dd>
        <dt>{translate("workbench.blueprint.detailsUpdatedAt")}</dt>
        <dd>{record.updatedAt}</dd>
      </dl>
      <p className="blueprint-panel-note">{translate("workbench.blueprint.previewPending")}</p>
    </section>
  );
}