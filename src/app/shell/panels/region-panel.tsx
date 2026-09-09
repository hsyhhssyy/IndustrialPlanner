import { useState } from "react";
import { observer } from "mobx-react-lite";

import { createRegionBlueprintDocument } from "@/app/blueprint/save-blueprint";
import type { AppHost } from "@/app/host/app-host";
import { useEditorDocumentSnapshot } from "@/app/shell/hooks/use-editor-document";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import type { RegionAnnotation } from "@/domain/document/region-annotation";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import {
  resolveRegionShapeSummary,
} from "@/shared/geometry/region-rects";
import styles from "@/app/shell/panels/region-panel.module.scss";

interface RegionPanelCopy {
  readonly add: string;
  readonly boundary: string;
  readonly cancel: string;
  readonly cellUnit: string;
  readonly color: string;
  readonly contained: string;
  readonly create: string;
  readonly delete: string;
  readonly description: string;
  readonly edit: string;
  readonly empty: string;
  readonly finish: string;
  readonly focus: string;
  readonly hidden: string;
  readonly moveFeedback: string;
  readonly name: string;
  readonly noMatch: string;
  readonly reverseLookup: string;
  readonly saveBlueprint: string;
  readonly search: string;
  readonly selectDevices: string;
  readonly shape: string;
  readonly subtract: string;
  readonly visible: string;
}

const COPY: Record<"zh-CN" | "en-US", RegionPanelCopy> = {
  "zh-CN": {
    add: "添加格子",
    boundary: "压边设备",
    cancel: "取消",
    cellUnit: "格",
    color: "颜色",
    contained: "完整包含设备",
    create: "新建区域",
    delete: "删除",
    description: "说明（可选）",
    edit: "编辑形状与属性",
    empty: "暂无区域",
    finish: "完成",
    focus: "聚焦",
    hidden: "已隐藏",
    moveFeedback: "本次移动的区域关系变化",
    name: "名称",
    noMatch: "没有匹配的区域",
    reverseLookup: "当前所选设备所在区域",
    saveBlueprint: "保存为蓝图",
    search: "搜索区域",
    selectDevices: "选择包含的设备",
    shape: "形状",
    subtract: "减去格子",
    visible: "可见",
  },
  "en-US": {
    add: "Add Cells",
    boundary: "Boundary Devices",
    cancel: "Cancel",
    cellUnit: "cells",
    color: "Color",
    contained: "Contained Devices",
    create: "New Region",
    delete: "Delete",
    description: "Description (optional)",
    edit: "Edit Shape & Properties",
    empty: "No regions",
    finish: "Done",
    focus: "Focus",
    hidden: "Hidden",
    moveFeedback: "Region changes from this move",
    name: "Name",
    noMatch: "No matching regions",
    reverseLookup: "Regions for Selected Devices",
    saveBlueprint: "Save as Blueprint",
    search: "Search regions",
    selectDevices: "Select Contained Devices",
    shape: "Shape",
    subtract: "Subtract Cells",
    visible: "Visible",
  },
};

export const RegionPanel = observer(function RegionPanel({ appHost }: { appHost: AppHost }) {
  const editor = appHost.workspace.editor;
  const currentDocument = useEditorDocumentSnapshot(editor);
  const [searchQuery, setSearchQuery] = useState("");
  const copy = COPY[appHost.state.settings.locale];
  const regions = currentDocument?.regions ?? [];
  const regionState = editor?.state.regionAnnotations;
  const selectedRegion = regions.find((region) => region.id === regionState?.selectedId) ?? null;
  const draft = regionState?.draft ?? null;
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const filteredRegions = regions.filter((region) => (
    normalizedSearch === ""
    || region.name.toLocaleLowerCase().includes(normalizedSearch)
    || region.description.toLocaleLowerCase().includes(normalizedSearch)
  ));
  const selectedEntityIds = editor === null
    ? []
    : Array.from(editor.state.collections.selection);
  const reverseLookupRegions = (() => {
    if (editor === null || selectedEntityIds.length === 0) {
      return [];
    }
    const selectedIdSet = new Set(selectedEntityIds);
    return regions.filter((region) => (
      editor.queries.findRegionEntityIds(region.id, "contained").some((id) => selectedIdSet.has(id))
      || editor.queries.findRegionEntityIds(region.id, "boundary").some((id) => selectedIdSet.has(id))
    ));
  })();
  const containedIds = selectedRegion === null || editor === null
    ? []
    : editor.queries.findRegionEntityIds(selectedRegion.id, "contained");
  const boundaryIds = selectedRegion === null || editor === null
    ? []
    : editor.queries.findRegionEntityIds(selectedRegion.id, "boundary");

  if (editor === null || currentDocument === null || regionState === undefined) {
    return <div className={styles.empty}>{copy.empty}</div>;
  }

  const startDraft = (regionId?: string) => {
    editor.actions.beginRegionDraft(regionId);
    appHost.internalActions.setActiveTool("region-edit");
  };

  return (
    <div className={styles.panel} data-region-panel="true">
      <div className={styles.topActions}>
        <button data-region-create="true" onClick={() => startDraft()} type="button">
          {copy.create}
        </button>
        <input
          aria-label={copy.search}
          onChange={(event) => setSearchQuery(event.currentTarget.value)}
          placeholder={copy.search}
          type="search"
          value={searchQuery}
        />
      </div>

      <div className={styles.regionList}>
        {filteredRegions.length === 0 ? <div className={styles.empty}>{regions.length === 0 ? copy.empty : copy.noMatch}</div> : null}
        {filteredRegions.map((region) => {
          const selected = region.id === selectedRegion?.id;
          const hidden = regionState.hiddenIds.includes(region.id);
          return (
            <div
              className={selected ? `${styles.regionItem} ${styles.selected}` : styles.regionItem}
              data-region-id={region.id}
              key={region.id}
              onMouseEnter={() => editor.actions.setRegionHovered(region.id)}
              onMouseLeave={() => editor.actions.setRegionHovered(null)}
            >
              <button
                className={styles.regionSelect}
                onClick={() => editor.actions.selectRegion(region.id)}
                type="button"
              >
                <span className={styles.swatch} style={{ backgroundColor: region.color }} />
                <span className={styles.regionCopy}>
                  <strong>{region.name}</strong>
                  <small>{resolveRegionShapeSummary(region.rects, copy.cellUnit)}</small>
                </span>
              </button>
              <button
                aria-label={hidden ? copy.hidden : copy.visible}
                className={styles.iconButton}
                onClick={() => editor.actions.setRegionVisible(region.id, hidden)}
                title={hidden ? copy.hidden : copy.visible}
                type="button"
              >
                <WorkbenchIcon kind={hidden ? "eye-off" : "eye"} />
              </button>
            </div>
          );
        })}
      </div>

      {reverseLookupRegions.length > 0 ? (
        <section className={styles.section}>
          <h3>{copy.reverseLookup}</h3>
          <div className={styles.linkList}>
            {reverseLookupRegions.map((region) => (
              <button key={region.id} onClick={() => editor.actions.selectRegion(region.id)} type="button">
                {region.name}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {draft === null && selectedRegion !== null ? (
        <RegionDetails
          boundaryCount={boundaryIds.length}
          containedCount={containedIds.length}
          copy={copy}
          onDelete={() => {
            if (window.confirm(`${copy.delete}“${selectedRegion.name}”？`)) {
              editor.actions.deleteRegion(selectedRegion.id);
            }
          }}
          onEdit={() => startDraft(selectedRegion.id)}
          onFocus={() => editor.actions.focusOnRegion(selectedRegion.id)}
          onSaveBlueprint={() => {
            const blueprint = createRegionBlueprintDocument({
              workspace: appHost.workspace,
              regionId: selectedRegion.id,
            });
            if (blueprint !== null) {
              appHost.saveBlueprintDialog.openRegion(blueprint);
            }
          }}
          onSelectDevices={() => {
            editor.actions.clearCollection(EntityCollectionType.selection);
            for (const entityId of containedIds) {
              editor.actions.addToCollection({
                collectionType: EntityCollectionType.selection,
                entityId,
              });
            }
            appHost.internalActions.setActiveTool("select");
          }}
          region={selectedRegion}
        />
      ) : null}

      {draft !== null ? (
        <section className={styles.editor} data-region-editor="true">
          <label>
            <span>{copy.name}</span>
            <input
              maxLength={10_000}
              onChange={(event) => editor.actions.updateRegionDraft({ name: event.currentTarget.value })}
              value={draft.name}
            />
          </label>
          <label>
            <span>{copy.description}</span>
            <textarea
              maxLength={10_000}
              onChange={(event) => editor.actions.updateRegionDraft({ description: event.currentTarget.value })}
              value={draft.description}
            />
          </label>
          <label className={styles.colorField}>
            <span>{copy.color}</span>
            <input
              onChange={(event) => editor.actions.updateRegionDraft({ color: event.currentTarget.value })}
              type="color"
              value={draft.color}
            />
          </label>
          <div className={styles.operationButtons}>
            <button
              aria-pressed={regionState.draftOperation === "add"}
              className={regionState.draftOperation === "add" ? styles.active : undefined}
              onClick={() => editor.actions.setRegionDraftOperation("add")}
              type="button"
            >
              {copy.add}
            </button>
            <button
              aria-pressed={regionState.draftOperation === "subtract"}
              className={regionState.draftOperation === "subtract" ? styles.active : undefined}
              onClick={() => editor.actions.setRegionDraftOperation("subtract")}
              type="button"
            >
              {copy.subtract}
            </button>
          </div>
          <div className={styles.shapeSummary}>{`${copy.shape}：${resolveRegionShapeSummary(draft.rects, copy.cellUnit)}`}</div>
          <div className={styles.editorActions}>
            <button
              data-region-commit="true"
              disabled={draft.rects.length === 0}
              onClick={() => {
                if (editor.actions.commitRegionDraft()) {
                  appHost.internalActions.setActiveTool("select");
                }
              }}
              type="button"
            >
              {copy.finish}
            </button>
            <button
              data-region-cancel="true"
              onClick={() => {
                editor.actions.cancelRegionDraft();
                appHost.internalActions.setActiveTool("select");
              }}
              type="button"
            >
              {copy.cancel}
            </button>
          </div>
        </section>
      ) : null}

      {regionState.moveFeedback !== null ? (
        <section className={styles.section} data-region-move-feedback="true">
          <h3>{copy.moveFeedback}</h3>
          <ul className={styles.feedbackList}>
            {regionState.moveFeedback.changes.map((change) => {
              const regionName = regions.find((region) => region.id === change.regionId)?.name ?? change.regionId;
              return <li key={change.regionId}>{`${regionName}：+${change.enteredCount} / −${change.exitedCount}，${copy.boundary} ${change.boundaryCount}`}</li>;
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
});

function RegionDetails({
  boundaryCount,
  containedCount,
  copy,
  onDelete,
  onEdit,
  onFocus,
  onSaveBlueprint,
  onSelectDevices,
  region,
}: {
  readonly boundaryCount: number;
  readonly containedCount: number;
  readonly copy: RegionPanelCopy;
  readonly onDelete: () => void;
  readonly onEdit: () => void;
  readonly onFocus: () => void;
  readonly onSaveBlueprint: () => void;
  readonly onSelectDevices: () => void;
  readonly region: RegionAnnotation;
}) {
  return (
    <section className={styles.details} data-region-details="true">
      <div className={styles.detailTitle}>
        <span className={styles.swatch} style={{ backgroundColor: region.color }} />
        <strong>{region.name}</strong>
      </div>
      {region.description === "" ? null : <p>{region.description}</p>}
      <dl>
        <div><dt>{copy.shape}</dt><dd>{resolveRegionShapeSummary(region.rects, copy.cellUnit)}</dd></div>
        <div><dt>{copy.contained}</dt><dd>{containedCount}</dd></div>
        <div><dt>{copy.boundary}</dt><dd>{boundaryCount}</dd></div>
      </dl>
      <div className={styles.detailActions}>
        <button onClick={onFocus} type="button">{copy.focus}</button>
        <button onClick={onEdit} type="button">{copy.edit}</button>
        <button disabled={containedCount === 0} onClick={onSelectDevices} type="button">{copy.selectDevices}</button>
        <button disabled={containedCount === 0} onClick={onSaveBlueprint} type="button">{copy.saveBlueprint}</button>
        <button className={styles.danger} onClick={onDelete} type="button">{copy.delete}</button>
      </div>
    </section>
  );
}
