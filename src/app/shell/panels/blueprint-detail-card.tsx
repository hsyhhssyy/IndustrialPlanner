/* AI-REMOVED 2026-05-09:
Reason: 蓝图 dock 已删除底部预览 inspector，详情卡实现整体归档。
Trigger: 用户要求删除蓝图 dock 下方的预览 inspector。
Evidence: BlueprintDirectoryBrowser 已移除 BlueprintDetailCard 渲染，蓝图预览统一由 BlueprintPreviewDialog 承载。
Replacement: src/app/shell/dialogs/blueprint-preview-dialog.tsx
Risk: Low
Human Review: Required

Original code:
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

import { preventTouchPointerCompatibilityMouseEvents } from "@/app/shell/shared/ui-shell-null-handlers";
import type { BlueprintLibraryRecord } from "@/shared/blueprints/blueprint-library";

export interface BlueprintDetailPlaceEventInput {
  readonly source: "mouse" | "touch";
  readonly button: number;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly sourceEvent: Event;
}

interface BlueprintDetailCardProps {
  readonly translate: (key: string) => string;
  readonly record: BlueprintLibraryRecord;
  readonly onPlace?: (input: BlueprintDetailPlaceEventInput) => void;
}

export function BlueprintDetailCard({
  translate,
  record,
  onPlace,
}: BlueprintDetailCardProps) {
  const placeLabel = translate("tool.place");
  const handlePlacePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (onPlace === undefined) {
      return;
    }

    if (event.pointerType === "mouse") {
      onPlace({
        source: "mouse",
        button: event.button,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        sourceEvent: event.nativeEvent,
      });
      return;
    }

    if (event.pointerType === "touch" || event.pointerType === "pen") {
      onPlace({
        source: "touch",
        button: 0,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        sourceEvent: event.nativeEvent,
      });
    }
  };
  const handlePlaceClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (onPlace === undefined || event.detail !== 0) {
      return;
    }

    onPlace({
      source: "mouse",
      button: 0,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      sourceEvent: event.nativeEvent,
    });
  };

  return (
    <section className="placeholder-section blueprint-detail-card">
      <div className="placeholder-section-header">
        <h3>{translate("workbench.blueprint.detailsTitle")}</h3>
        <span className="pill">{record.version}</span>
      </div>
      <button
        className="save-blueprint-primary-button blueprint-detail-place-button"
        data-ui-button-id="blueprint-detail-place-button"
        onClick={handlePlaceClick}
        onPointerDown={preventTouchPointerCompatibilityMouseEvents}
        onPointerUp={handlePlacePointerUp}
        type="button"
      >
        {placeLabel}
      </button>
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
    </section>
  );
}
*/