import { useEffect, useState } from "react";

import LucideChevronsRight from "~icons/lucide/chevrons-right";
import LucideMinus from "~icons/lucide/minus";
import LucidePlus from "~icons/lucide/plus";
import LucideX from "~icons/lucide/x";

import type { AppHost } from "@/app/host/app-host";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { SlotConfigInspectorDeclaration } from "@/domain/registry/types/entity-inspector";
import type { ItemDefinition } from "@/domain/registry/types/item-definition";
import type { SimulationDeviceRuntimeStatusReadModel } from "@/domain/simulation/types/simulation-types";
import {
  useInspectorDataScope,
  useInspectorRenderMode,
  type InspectorDataScope,
} from "@/app/shell/inspector/selection-inspector-model";
import { InspectorCollapsiblePanel } from "@/app/shell/inspector/inspector-collapsible-panel";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import { createItemIconAssetUrl } from "@/shared/browser/public-asset-url";
import { NumberInput } from "@/app/shell/shared/number-input";
import { OverlayStackLayer } from "@/app/shell/shared/overlay-stack";
import {
  matchesItemDomainFilter,
  type InspectorItemDomainFilter,
} from "./item-domain";

type StorageSlotGroupDefinition = EntityDefinition["storageSlotGroups"][number];
type StorageSlotDefinition = StorageSlotGroupDefinition["slots"][number];

interface EffectiveSlotRow {
  storageGroupId: string;
  groupIndex: number;
  slotId: string;
  slotIndex: number;
  displayIndex: number;
  itemPath: string;
  countPath: string;
  ignoreStockPath: string;
  capacity: number;
  count: number;
  ignoreStock: boolean;
  lockItemId: string | null;
  initialItemType: string | null;
  displayItemId: string | null;
  domain: InspectorItemDomainFilter;
  source: InspectorDataScope;
}

interface SlotConfigGroupView {
  storageGroup: StorageSlotGroupDefinition;
  groupIndex: number;
  rows: EffectiveSlotRow[];
}

type SlotConfigColumnRole = "input" | "output";
type SlotConfigResolvedRole = SlotConfigColumnRole | "shared";

interface SlotConfigRoleGroupView extends SlotConfigGroupView {
  role: SlotConfigResolvedRole;
}

export function SlotConfigInspector({
  appHost,
  declaration,
  entity,
  definition,
  runtimeStatus,
  translate,
}: {
  appHost: AppHost;
  declaration: SlotConfigInspectorDeclaration;
  entity: WorldEntity;
  definition: EntityDefinition;
  runtimeStatus?: SimulationDeviceRuntimeStatusReadModel | null;
  translate: (key: string) => string;
}) {
  const mode = useInspectorRenderMode();
  const { scope, canUseRuntimeState, setScope } = useInspectorDataScope();
  const [pendingSlotId, setPendingSlotId] = useState<string | null>(null);
  const [editingSlot, setEditingSlot] = useState<EffectiveSlotRow | null>(null);
  const [draftItemId, setDraftItemId] = useState<string | null>(null);
  const [draftCount, setDraftCount] = useState(0);
  const [draftIgnoreStock, setDraftIgnoreStock] = useState(false);

  const activeScope = canUseRuntimeState ? scope : "initial-config";
  const editModeEnabled = activeScope === "initial-config";
  const itemById = new Map(
    appHost.workspace.registry.itemDefinitions.map((item) => [item.id, item]),
  );
  const runtimeSlotByKey = buildRuntimeSlotMap(runtimeStatus ?? null);
  const debugMode = appHost.state?.settings?.debugMode === true;
  const slotGroupIds = debugMode
    ? definition.storageSlotGroups.map((storageGroup) => storageGroup.id)
    : declaration.slotGroupIds;
  const groupViews = resolveSlotConfigGroupViews({
    slotGroupIds,
    definition,
    entity,
    runtimeSlotByKey,
    scope: activeScope,
  });

  useEffect(() => {
    setEditingSlot(null);
  }, [activeScope, entity.id]);

  const scopeSwitch = (
    <label
      className={cm(styles, "slot-config-scope-switch", canUseRuntimeState ? "" : "is-disabled")}
      title={canUseRuntimeState ? undefined : "当前状态仅在仿真运行时可用"}
    >
      <span className={cm(styles, "slot-config-scope-switch-copy")}>
        <span>编辑模式</span>
        {/*
          AI-REMOVED 2026-06-04:
          Reason: 开关控件已经表达开启/关闭状态，旁边文字重复表达同一信息。
          Trigger: 用户要求文字、颜色、图标、边框等元素不能传递重复信息。
          Evidence: InspectorPanel设计风格规范 2.5 明确“开关控件已经表达开/关时，不再显示开启/关闭文案”。
          Replacement: checkbox visual state + aria-label
          Risk: Low
          Human Review: Required

          Original code:
          <strong>{editModeEnabled ? "开启" : "关闭"}</strong>
        */}
      </span>
      <input
        aria-label="编辑模式"
        checked={editModeEnabled}
        className={cm(styles, "slot-config-scope-switch-input")}
        data-inspector-scope-switch
        disabled={!canUseRuntimeState}
        onChange={(event) => {
          setScope(event.currentTarget.checked ? "initial-config" : "runtime-state");
        }}
        type="checkbox"
      />
    </label>
  );

  if (groupViews.length === 0) {
    return (
      <InspectorCollapsiblePanel
        className="slot-config-inspector"
        dataInspectorKey="slot-config"
        headerActions={scopeSwitch}
        title="槽位配置"
        titleClassName="slot-config-panel-title"
      >
        {/*
          AI-REMOVED 2026-05-26:
          Reason: inspector 卡片不再显示标题。
          Trigger: 槽位配置 inspector 需求要求所有 inspector 无标题和副标题。
          Evidence: 用户明确要求“所有inspector都没有标题和副标题”。
          Replacement: slot-config-empty 只显示主体状态。
          Risk: Low
          Human Review: Required

          Original code:
          <h4>槽位配置</h4>
        */}
        <div className={cm(styles, "slot-config-empty")}>未找到可编辑的槽位组。</div>
      </InspectorCollapsiblePanel>
    );
  }

  const patchEntityConfig = (patch: Record<string, unknown>) => {
    appHost.workspace.editor?.actions.patchEntityConfig(entity.id, patch);
  };

  const openSlotEditor = (row: EffectiveSlotRow) => {
    const itemId = row.lockItemId ?? row.displayItemId;
    setEditingSlot(row);
    setDraftItemId(itemId);
    setDraftCount(row.count);
    setDraftIgnoreStock(itemId === null ? false : row.ignoreStock);
  };

  const requestDraftItemSelection = async (
    row: EffectiveSlotRow,
    rows: readonly EffectiveSlotRow[],
  ) => {
    if (row.lockItemId !== null) {
      return;
    }

    setPendingSlotId(row.slotId);

    try {
      const rowsForFilter = rows.map((candidate) =>
        candidate.slotId === row.slotId
          ? { ...candidate, displayItemId: draftItemId }
          : candidate,
      );
      const rowForFilter = rowsForFilter.find((candidate) => candidate.slotId === row.slotId) ?? row;
      const itemId = await appHost.encyclopediaPicker.pickItem({
        title: translate("encyclopediaPicker.title.item"),
        filterItem: (item) => canSelectItemForRow(
          item,
          rowForFilter,
          rowsForFilter,
          appHost.workspace.registry.queries.resolveItemDomain,
        ),
      });

      if (itemId === null) {
        return;
      }

      setDraftItemId(itemId);
      setDraftCount((current) => current > 0 ? current : Math.min(1, row.capacity));
    } finally {
      setPendingSlotId((current) => current === row.slotId ? null : current);
    }
  };

  const applySlotDraft = async () => {
    if (editingSlot === null) {
      return;
    }

    const itemType = editingSlot.lockItemId ?? draftItemId;
    const count = itemType === null ? 0 : clampCount(draftCount, editingSlot.capacity);
    const ignoreStock = itemType === null ? false : draftIgnoreStock;

    if (editingSlot.source === "runtime-state") {
      await appHost.workspace.simulation?.actions.patchRuntimeSlot({
        entityId: entity.id,
        storageGroupId: editingSlot.storageGroupId,
        slotId: editingSlot.slotId,
        itemType,
        count,
        ignoreStock,
      });
      setEditingSlot(null);
      return;
    }

    patchEntityConfig({
      [editingSlot.itemPath]: itemType,
      [editingSlot.countPath]: count,
      [editingSlot.ignoreStockPath]: ignoreStock,
    });
    setEditingSlot(null);
  };

  const clearDraft = () => {
    if (editingSlot?.lockItemId !== null && editingSlot?.lockItemId !== undefined) {
      setDraftItemId(editingSlot.lockItemId);
      setDraftCount(0);
      setDraftIgnoreStock(false);
      return;
    }

    setDraftItemId(null);
    setDraftCount(0);
    setDraftIgnoreStock(false);
  };

  const editingGroupRows = editingSlot === null
    ? []
    : groupViews.find((groupView) => groupView.storageGroup.id === editingSlot.storageGroupId)?.rows ?? [editingSlot];
  const editingItemDefinition = draftItemId === null ? null : itemById.get(draftItemId) ?? null;
  const editingItemLabel = editingItemDefinition === null
    ? "未选择物品"
    : translate(editingItemDefinition.nameKey);
  const roleGroupViews = resolveSlotConfigRoleGroupViews(definition, groupViews);
  const inputGroupViews = roleGroupViews.filter((groupView) => groupView.role === "input");
  const outputGroupViews = roleGroupViews.filter((groupView) => groupView.role === "output");
  const sharedGroupViews = roleGroupViews.filter((groupView) => groupView.role === "shared");

  const renderSlotColumn = (
    role: SlotConfigColumnRole,
    roleGroupViews: readonly SlotConfigRoleGroupView[],
  ) => {
    const rows = roleGroupViews.flatMap((groupView) => groupView.rows);
    /*
      AI-REMOVED 2026-06-04:
      Reason: filled/total 计数重复下方槽位列表可直接读取或数出的信息。
      Trigger: 用户要求用户能从主区域直接数出的结果不再额外显示 summary。
      Evidence: InspectorPanel设计风格规范 2.5 / 3.5。
      Replacement: None
      Risk: Low
      Human Review: Required

      Original code:
      const filledCount = rows.filter((row) => row.displayItemId !== null).length;
    */
    const roleIndexBySlotKey = new Map(
      rows.map((row, rowIndex) => [createRuntimeSlotKey(row.storageGroupId, row.slotId), rowIndex + 1]),
    );
    const roleLabel = role === "input" ? "输入" : "输出";
    const roleTitle = role === "input" ? "原料输入" : "产物输出";
    /*
      AI-REMOVED 2026-06-04:
      Reason: 输入/输出角色图标与标题“原料输入 / 产物输出”重复表达角色。
      Trigger: 用户要求图标与文字不能传递重复信息。
      Evidence: 标题已直接表达列角色。
      Replacement: slot-config-flow-column-header strong
      Risk: Low
      Human Review: Required

      Original code:
      const RoleIcon = role === "input" ? LucideDownload : LucideUpload;
    */

    return (
      <section
        className={cm(styles, `slot-config-flow-column is-${role}`)}
        data-slot-config-role={role}
      >
        <div className={cm(styles, "slot-config-flow-column-header")}>
          {/*
            AI-REMOVED 2026-06-04:
            Reason: 输入/输出角色图标与标题“原料输入 / 产物输出”重复表达角色。
            Trigger: 用户要求图标与文字不能传递重复信息。
            Evidence: 标题已经直接表达列角色。
            Replacement: slot-config-flow-column-header strong
            Risk: Low
            Human Review: Required

            Original code:
            <RoleIcon aria-hidden="true" />
          */}
          <div>
            <strong>{roleTitle}</strong>
            {/*
              AI-REMOVED 2026-06-04:
              Reason: “输入/输出槽位 (filled/total)”重复标题与下方槽位列表。
              Trigger: 用户要求主区域可直接读出或数出的信息不重复显示。
              Evidence: 下方列表已展示每个槽位及是否有物品。
              Replacement: None
              Risk: Low
              Human Review: Required

              Original code:
              <span>{`${roleLabel}槽位 (${filledCount}/${rows.length})`}</span>
            */}
          </div>
        </div>
        <div className={cm(styles, "slot-config-flow-slot-list")}>
          {roleGroupViews.length === 0 ? (
            <div className={cm(styles, "slot-config-flow-empty")}>{`暂无${roleLabel}槽位`}</div>
          ) : roleGroupViews.map((groupView) => (
            <section
              className={cm(styles, "slot-config-group")}
              data-slot-config-group={groupView.storageGroup.id}
              data-slot-config-group-role={groupView.role}
              data-slot-config-group-size={groupView.rows.length > 1 ? "multi" : "single"}
              key={groupView.storageGroup.id}
            >
              {groupView.rows.map((row) => {
                const roleIndex = roleIndexBySlotKey.get(createRuntimeSlotKey(row.storageGroupId, row.slotId)) ?? row.displayIndex;
                const emptySlotLabel = `${roleLabel}槽位 ${roleIndex}`;
                const itemDefinition = row.displayItemId === null
                  ? null
                  : itemById.get(row.displayItemId) ?? null;
                const itemLabel = itemDefinition === null ? emptySlotLabel : translate(itemDefinition.nameKey);
                const iconSrc = itemDefinition === null ? null : resolveItemIconSrc(itemDefinition);

                return (
                  <button
                    aria-label={itemLabel}
                    className={cm(styles, "slot-config-flow-slot")}
                    data-slot-action="open-slot-editor"
                    data-slot-number={row.displayIndex}
                    key={row.slotId}
                    onClick={() => {
                      openSlotEditor(row);
                    }}
                    title={itemLabel}
                    type="button"
                  >
                    {iconSrc === null ? (
                      <>
                        <span className={cm(styles, "slot-config-flow-slot-label")}>
                          {emptySlotLabel}
                        </span>
                        <span className={cm(styles, "slot-config-flow-slot-value")}>
                          <span className={cm(styles, "slot-config-flow-empty-button")}>
                            <LucidePlus aria-hidden="true" />
                          </span>
                        </span>
                      </>
                    ) : (
                      <span className={cm(styles, "slot-config-flow-slot-item")}>
                        <img
                          alt=""
                          className={cm(styles, "slot-config-flow-item-icon")}
                          draggable={false}
                          src={iconSrc}
                        />
                        <span className={cm(styles, "slot-config-flow-slot-label")}>
                          {itemLabel}
                        </span>
                        <span className={cm(styles, "slot-config-flow-item-count-inline")}>
                          {row.ignoreStock ? "∞" : row.count}
                        </span>
                      </span>
                    )}
                  </button>
                );
              })}
            </section>
          ))}
        </div>
      </section>
    );
  };

  const renderSharedColumn = (
    roleGroupViews: readonly SlotConfigRoleGroupView[],
  ) => {
    const rows = roleGroupViews.flatMap((groupView) => groupView.rows);
    /*
      AI-REMOVED 2026-06-04:
      Reason: shared 槽位 filled/total 计数重复下方槽位列表。
      Trigger: 用户要求可从主区域直接数出的信息不重复显示。
      Evidence: InspectorPanel设计风格规范 2.5 / 3.5。
      Replacement: None
      Risk: Low
      Human Review: Required

      Original code:
      const filledCount = rows.filter((row) => row.displayItemId !== null).length;
    */
    const roleIndexBySlotKey = new Map(
      rows.map((row, rowIndex) => [createRuntimeSlotKey(row.storageGroupId, row.slotId), rowIndex + 1]),
    );

    return (
      <section
        className={cm(styles, `slot-config-flow-column is-shared`)}
        data-slot-config-role="shared"
      >
        <div className={cm(styles, "slot-config-flow-column-header")}>
          {/*
            AI-REMOVED 2026-06-04:
            Reason: 共享角色图标与标题“混合缓冲”重复表达共享/混合语义。
            Trigger: 用户要求图标与文字不能传递重复信息。
            Evidence: 标题已直接表达该列角色。
            Replacement: slot-config-flow-column-header strong
            Risk: Low
            Human Review: Required

            Original code:
            <LucideArrowLeftRight aria-hidden="true" />
          */}
          <div>
            <strong>混合缓冲</strong>
            {/*
              AI-REMOVED 2026-06-04:
              Reason: “输入/输出共享槽位 (filled/total)”重复标题与下方槽位列表。
              Trigger: 用户要求 summary 不重复主区域可直接读出或数出的信息。
              Evidence: 下方列表已展示共享槽位内容。
              Replacement: None
              Risk: Low
              Human Review: Required

              Original code:
              <span>{`输入/输出共享槽位 (${filledCount}/${rows.length})`}</span>
            */}
          </div>
        </div>
        <div className={cm(styles, "slot-config-flow-slot-list")}>
          {roleGroupViews.length === 0 ? (
            <div className={cm(styles, "slot-config-flow-empty")}>暂无共享槽位</div>
          ) : roleGroupViews.map((groupView) => (
            <section
              className={cm(styles, "slot-config-group")}
              data-slot-config-group={groupView.storageGroup.id}
              data-slot-config-group-role={groupView.role}
              data-slot-config-group-size={groupView.rows.length > 1 ? "multi" : "single"}
              key={groupView.storageGroup.id}
            >
              {groupView.rows.map((row) => {
                const roleIndex = roleIndexBySlotKey.get(createRuntimeSlotKey(row.storageGroupId, row.slotId)) ?? row.displayIndex;
                const emptySlotLabel = `槽位 ${roleIndex}`;
                const itemDefinition = row.displayItemId === null
                  ? null
                  : itemById.get(row.displayItemId) ?? null;
                const itemLabel = itemDefinition === null ? emptySlotLabel : translate(itemDefinition.nameKey);
                const iconSrc = itemDefinition === null ? null : resolveItemIconSrc(itemDefinition);

                return (
                  <button
                    aria-label={itemLabel}
                    className={cm(styles, "slot-config-flow-slot")}
                    data-slot-action="open-slot-editor"
                    data-slot-number={row.displayIndex}
                    key={row.slotId}
                    onClick={() => {
                      openSlotEditor(row);
                    }}
                    title={itemLabel}
                    type="button"
                  >
                    {iconSrc === null ? (
                      <>
                        <span className={cm(styles, "slot-config-flow-slot-label")}>
                          {emptySlotLabel}
                        </span>
                        <span className={cm(styles, "slot-config-flow-slot-value")}>
                          <span className={cm(styles, "slot-config-flow-empty-button")}>
                            <LucidePlus aria-hidden="true" />
                          </span>
                        </span>
                      </>
                    ) : (
                      <span className={cm(styles, "slot-config-flow-slot-item")}>
                        <img
                          alt=""
                          className={cm(styles, "slot-config-flow-item-icon")}
                          draggable={false}
                          src={iconSrc}
                        />
                        <span className={cm(styles, "slot-config-flow-slot-label")}>
                          {itemLabel}
                        </span>
                        <span className={cm(styles, "slot-config-flow-item-count-inline")}>
                          {row.ignoreStock ? "∞" : row.count}
                        </span>
                      </span>
                    )}
                  </button>
                );
              })}
            </section>
          ))}
        </div>
      </section>
    );
  };

  return (
    <InspectorCollapsiblePanel
      bodyClassName="slot-config-panel-body"
      className="slot-config-inspector"
      data-inspector-scope={activeScope}
      dataInspectorKey="slot-config"
      data-render-mode={mode}
      headerActions={scopeSwitch}
      title="槽位配置"
      titleClassName="slot-config-panel-title"
    >
      {/*
        AI-REMOVED 2026-05-31:
        Reason: 槽位配置 UI 从正方形 tile 网格改为设计稿中的左右输入/输出流程布局。
        Trigger: 用户要求按 inspector dialog 设计稿 1:1 调整槽位配置 UI。
        Evidence: 设计稿使用蓝色输入栏、橙色输出栏和中间加工流向箭头。
        Replacement: slot-config-flow-layout / slot-config-flow-column / slot-config-flow-slot。
        Risk: Low
        Human Review: Required

        Original code:
        {groupViews.map((groupView) => (
          <section
            className={cm(styles, "slot-config-group")}
            data-slot-config-group={groupView.storageGroup.id}
            data-slot-config-group-size={groupView.rows.length > 1 ? "multi" : "single"}
            key={groupView.storageGroup.id}
          >
            <div className={cm(styles, "slot-config-tile-grid")} data-render-mode={mode}>
              {groupView.rows.map((row) => {
                const itemDefinition = row.displayItemId === null
                  ? null
                  : itemById.get(row.displayItemId) ?? null;
                const itemLabel = itemDefinition === null ? "空槽位" : translate(itemDefinition.nameKey);
                const iconSrc = itemDefinition === null ? null : resolveItemIconSrc(itemDefinition);

                return (
                  <button
                    aria-label={`${row.displayIndex}. ${itemLabel}`}
                    className={cm(styles, "slot-config-tile")}
                    data-slot-action="open-slot-editor"
                    data-slot-number={row.displayIndex}
                    key={row.slotId}
                    onClick={() => {
                      openSlotEditor(row);
                    }}
                    title={itemLabel}
                    type="button"
                  >
                    <span className={cm(styles, "slot-config-tile-index")}>{row.displayIndex}</span>
                    {iconSrc === null ? (
                      <span className={cm(styles, "slot-config-empty-frame")}>
                        <LucidePlus aria-hidden="true" />
                      </span>
                    ) : (
                      <>
                        <img
                          alt=""
                          className={cm(styles, "slot-config-tile-icon")}
                          draggable={false}
                          src={iconSrc}
                        />
                        <span className={cm(styles, "slot-config-tile-badge")}>
                          {row.ignoreStock ? "∞" : row.count}
                        </span>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      */}
      {(inputGroupViews.length > 0 || outputGroupViews.length > 0) && (
        <>
          <div className={cm(styles, "slot-config-flow-layout")}>
            {renderSlotColumn("input", inputGroupViews)}
            <div className={cm(styles, "slot-config-flow-direction")} aria-label="加工流向">
              {/*
                AI-REMOVED 2026-06-04:
                Reason: 流向文字与箭头图标重复表达加工流向。
                Trigger: 用户要求文字与图标不能传递重复信息。
                Evidence: 该容器保留 aria-label，视觉上由箭头和左右列位置表达流向。
                Replacement: LucideChevronsRight + aria-label
                Risk: Low
                Human Review: Required

                Original code:
                <span>加工流向</span>
              */}
              <LucideChevronsRight aria-hidden="true" />
            </div>
            {renderSlotColumn("output", outputGroupViews)}
          </div>
        </>
      )}
      {sharedGroupViews.length > 0 && (
        <div className={cm(styles, "slot-config-shared-section")}>
          {renderSharedColumn(sharedGroupViews)}
        </div>
      )}
      {editingSlot !== null ? (
        <OverlayStackLayer
          layerId={`slot-config:${entity.id}:${editingSlot.storageGroupId}:${editingSlot.slotId}`}
          visible
        >
          {({ zIndex }) => (
            <div
              className={cm(styles, "slot-config-dialog-backdrop")}
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  setEditingSlot(null);
                }
              }}
              style={{ zIndex }}
            >
              <div
                aria-label="槽位配置器"
                aria-modal="true"
                className={cm(styles, "slot-config-dialog")}
                role="dialog"
              >
            <div className={cm(styles, "slot-config-dialog-header")}>
              <h3>槽位配置器</h3>
              <button
                aria-label="关闭"
                className={cm(styles, "slot-config-dialog-icon-button")}
                onClick={() => setEditingSlot(null)}
                title="关闭"
                type="button"
              >
                <LucideX aria-hidden="true" />
              </button>
            </div>
            <button
              className={cm(styles, "slot-config-dialog-item-button")}
              data-slot-dialog-action="pick-item"
              disabled={pendingSlotId === editingSlot.slotId || editingSlot.lockItemId !== null}
              onClick={() => {
                void requestDraftItemSelection(editingSlot, editingGroupRows);
              }}
              type="button"
            >
              {editingItemDefinition === null ? (
                <span className={cm(styles, "slot-config-empty-frame")}>
                  <LucidePlus aria-hidden="true" />
                </span>
              ) : (
                <img
                  alt=""
                  className={cm(styles, "slot-config-dialog-item-icon")}
                  draggable={false}
                  src={resolveItemIconSrc(editingItemDefinition)}
                />
              )}
            </button>
            <div className={cm(styles, "slot-config-dialog-item-name")}>{editingItemLabel}</div>
            <label className={cm(styles, "slot-config-dialog-field")}>
              {/*
                AI-REMOVED 2026-06-07:
                Reason: 数量输入、滑条和两个步进按钮挤在同一行，触发 CSS Grid 最小内容宽度，导致槽位弹窗在 tablet / mobile landscape 中横向溢出。
                Trigger: 用户反馈槽位管理弹窗添加滑条后界面乱套，并要求按 InspectorPanel 设计规范整理。
                Evidence: Playwright 三组 Screen Profile 基线截图显示 count row 将 dialog grid track 撑到 344px，超出 320px 弹窗；短屏下弹窗高度也超出视口。
                Replacement: 下方 slot-config-dialog-count-row + slot-config-dialog-slider-row 两行布局。
                Risk: Low
                Human Review: Required

                Original code:
                <span>数量</span>
                <div className={cm(styles, "slot-config-dialog-count-row")}>
                  <button
                    aria-label="减少数量"
                    className={cm(styles, "slot-config-step-button")}
                    disabled={draftItemId === null || draftCount <= 0}
                    onClick={() => setDraftCount(clampCount(draftCount - 1, editingSlot.capacity))}
                    type="button"
                  >
                    −
                  </button>
                  <input
                    aria-label="数量滑条"
                    className={cm(styles, "slot-config-dialog-range")}
                    disabled={draftItemId === null}
                    max={editingSlot.capacity}
                    min={0}
                    onChange={(event) => {
                      setDraftCount(clampCount(Number(event.currentTarget.value), editingSlot.capacity));
                    }}
                    type="range"
                    value={draftCount}
                  />
                  <button
                    aria-label="增加数量"
                    className={cm(styles, "slot-config-step-button")}
                    disabled={draftItemId === null || draftCount >= editingSlot.capacity}
                    onClick={() => setDraftCount(clampCount(draftCount + 1, editingSlot.capacity))}
                    type="button"
                  >
                    +
                  </button>
                  <NumberInput
                    className={cm(styles, "slot-config-count-input")}
                    data-slot-dialog-input="count"
                    disabled={draftItemId === null}
                    max={editingSlot.capacity}
                    min={0}
                    value={draftCount}
                    onCommit={(next) => {
                      setDraftCount(clampCount(next, editingSlot.capacity));
                    }}
                    onRawChange={(raw) => {
                      const next = Number(raw);
                      if (Number.isFinite(next)) {
                        setDraftCount(clampCount(next, editingSlot.capacity));
                      }
                    }}
                  />
                </div>
              */}
              <div className={cm(styles, "slot-config-dialog-count-row")}>
                <span>数量</span>
                <NumberInput
                  className={cm(styles, "slot-config-count-input")}
                  data-slot-dialog-input="count"
                  disabled={draftItemId === null}
                  max={editingSlot.capacity}
                  min={0}
                  value={draftCount}
                  onCommit={(next) => {
                    setDraftCount(clampCount(next, editingSlot.capacity));
                  }}
                  onRawChange={(raw) => {
                    const next = Number(raw);
                    if (Number.isFinite(next)) {
                      setDraftCount(clampCount(next, editingSlot.capacity));
                    }
                  }}
                />
              </div>
              <div className={cm(styles, "slot-config-dialog-slider-row")}>
                <button
                  aria-label="减少数量"
                  className={cm(styles, "slot-config-step-button")}
                  disabled={draftItemId === null || draftCount <= 0}
                  onClick={() => setDraftCount(clampCount(draftCount - 1, editingSlot.capacity))}
                  title="减少数量"
                  type="button"
                >
                  <LucideMinus aria-hidden="true" />
                </button>
                <input
                  aria-label="数量滑条"
                  className={cm(styles, "slot-config-dialog-range")}
                  disabled={draftItemId === null}
                  max={editingSlot.capacity}
                  min={0}
                  onChange={(event) => {
                    setDraftCount(clampCount(Number(event.currentTarget.value), editingSlot.capacity));
                  }}
                  type="range"
                  value={draftCount}
                />
                <button
                  aria-label="增加数量"
                  className={cm(styles, "slot-config-step-button")}
                  disabled={draftItemId === null || draftCount >= editingSlot.capacity}
                  onClick={() => setDraftCount(clampCount(draftCount + 1, editingSlot.capacity))}
                  title="增加数量"
                  type="button"
                >
                  <LucidePlus aria-hidden="true" />
                </button>
              </div>
            </label>
            <label className={cm(styles, "slot-config-dialog-switch")}>
              <input
                checked={draftIgnoreStock}
                disabled={draftItemId === null}
                onChange={(event) => {
                  setDraftIgnoreStock(event.currentTarget.checked);
                }}
                type="checkbox"
              />
              <span className={cm(styles, "slot-config-dialog-switch-track")} aria-hidden="true" />
              <span>无穷</span>
            </label>
            <button
              className={cm(styles, "slot-config-dialog-clear")}
              data-slot-dialog-action="clear-item"
              onClick={clearDraft}
              type="button"
            >
              清除
            </button>
            <div className={cm(styles, "slot-config-dialog-actions")}>
              <button
                data-slot-dialog-action="cancel"
                onClick={() => setEditingSlot(null)}
                type="button"
              >
                取消
              </button>
              <button
                data-slot-dialog-action="confirm"
                onClick={() => {
                  void applySlotDraft();
                }}
                type="button"
              >
                确定
              </button>
            </div>
              </div>
            </div>
          )}
        </OverlayStackLayer>
      ) : null}
    </InspectorCollapsiblePanel>
  );
}

interface RuntimeSlotView {
  readonly itemType: string | null;
  readonly count: number;
  readonly ignoreStock: boolean;
}

function buildRuntimeSlotMap(
  runtimeStatus: SimulationDeviceRuntimeStatusReadModel | null,
): Map<string, RuntimeSlotView> {
  const runtimeSlotByKey = new Map<string, RuntimeSlotView>();
  if (runtimeStatus === null) {
    return runtimeSlotByKey;
  }

  for (const slotItem of runtimeStatus.slotItems) {
    const key = createRuntimeSlotKey(slotItem.storageGroupId, slotItem.slotId);
    const existing = runtimeSlotByKey.get(key);
    runtimeSlotByKey.set(key, {
      itemType: existing?.itemType ?? slotItem.itemType,
      count: Math.max(existing?.count ?? 0, slotItem.count),
      ignoreStock: (existing?.ignoreStock ?? false) || slotItem.ignoreStock,
    });
  }

  return runtimeSlotByKey;
}

function resolveSlotConfigRoleGroupViews(
  definition: EntityDefinition,
  groupViews: readonly SlotConfigGroupView[],
): SlotConfigRoleGroupView[] {
  return groupViews.map((groupView) => ({
    ...groupView,
    role: resolveStorageGroupFlowRole(definition, groupView.storageGroup.id),
  }));
}

function resolveStorageGroupFlowRole(
  definition: EntityDefinition,
  storageGroupId: string,
): SlotConfigResolvedRole {
  if (definition.recipeChannels.length === 0) {
    return "shared";
  }

  let hasIngredientRole = false;
  let hasProductRole = false;

  for (const channel of definition.recipeChannels) {
    hasIngredientRole ||= channel.ingredientStorageGroupIds.includes(storageGroupId);
    hasProductRole ||= channel.productStorageGroupIds.includes(storageGroupId);
  }

  if (hasIngredientRole && hasProductRole) {
    return "shared";
  }

  if (hasProductRole) {
    return "output";
  }

  if (hasIngredientRole) {
    return "input";
  }

  /*
    AI-REMOVED 2026-06-06:
    Reason: 槽位配置的原料/产物归属应由 Recipe Channel 决定，端口方向只表达物流方向。
    Trigger: 用户确认无 channel、不在任何 channel、或同时出现在多类 channel 集合内的槽位一律显示为混合。
    Evidence: EntityDefinition 注释已明确“配方原料/产物角色由 Recipe Channel 声明”；旧实现会把无 channel 的纯物流槽位误显示为输入/输出。
    Replacement: 上方 recipeChannels ingredientStorageGroupIds / productStorageGroupIds 判定。
    Risk: Low
    Human Review: Required

    Original code:
    const directions = new Set<"input" | "output">();

    for (const binding of definition.portStorageBindings) {
      if (binding.storageSlotGroupId !== storageGroupId) {
        continue;
      }

      const portGroup = definition.portGroups.find((candidate) => candidate.id === binding.portGroupId);
      if (portGroup === undefined) {
        continue;
      }

      if (portGroup.direction === "bidirectional") {
        directions.add("input");
        directions.add("output");
        continue;
      }

      directions.add(portGroup.direction);
    }

    if (directions.has("input") && directions.has("output")) {
      return "shared";
    }

    if (directions.has("output")) {
      return "output";
    }

    return "input";
  */
  return "shared";
}

function resolveSlotConfigGroupViews(options: {
  slotGroupIds: readonly string[];
  definition: EntityDefinition;
  entity: WorldEntity;
  runtimeSlotByKey: ReadonlyMap<string, RuntimeSlotView>;
  scope: InspectorDataScope;
}): SlotConfigGroupView[] {
  let displayIndex = 1;

  return options.slotGroupIds.flatMap((groupId) => {
    const definition = options.definition;
    const groupIndex = definition.storageSlotGroups.findIndex((g) => g.id === groupId);

    if (groupIndex === -1) {
      return [];
    }

    const storageGroup = definition.storageSlotGroups[groupIndex];

    if (storageGroup === undefined) {
      return [];
    }

    const targetPath = `storageSlotGroups[${groupIndex}].slots`;

    return [{
      storageGroup,
      groupIndex,
      rows: storageGroup.slots.map((slot, slotIndex) => {
        const row = resolveEffectiveSlotRow({
          slot,
          slotIndex,
          displayIndex,
          storageGroup,
          groupIndex,
          targetPath,
          config: options.entity.config,
          runtimeSlot: options.runtimeSlotByKey.get(createRuntimeSlotKey(storageGroup.id, slot.id)) ?? null,
          scope: options.scope,
        });
        displayIndex += 1;
        return row;
      }),
    }];
  });
}

function resolveEffectiveSlotRow(options: {
  slot: StorageSlotDefinition;
  slotIndex: number;
  displayIndex: number;
  storageGroup: StorageSlotGroupDefinition;
  groupIndex: number;
  targetPath: string;
  config: WorldEntity["config"];
  runtimeSlot: RuntimeSlotView | null;
  scope: InspectorDataScope;
}): EffectiveSlotRow {
  const basePath = `${options.targetPath}[${options.slotIndex}]`;
  const capacity = readNumberOverride(options.config, `${basePath}.capacity`, options.slot.capacity);
  const lockItemId = readNullableStringOverride(options.config, `${basePath}.lock`, options.slot.lock);
  const initialItemType = readNullableStringOverride(
    options.config,
    `${basePath}.initialItemType`,
    options.slot.initialItemType,
  );
  const count = clampCount(
    readNumberOverride(options.config, `${basePath}.initialCount`, options.slot.initialCount),
    capacity,
  );
  const ignoreStock = readBooleanOverride(options.config, `${basePath}.ignoreStock`, options.slot.ignoreStock);
  const effectiveItemFilterType = readFilterTypeOverride(
    options.config,
    `${basePath}.itemFilterType`,
    options.slot.itemFilterType,
  );
  const runtimeItemType = options.runtimeSlot?.itemType ?? lockItemId;
  const runtimeCount = clampCount(options.runtimeSlot?.count ?? 0, capacity);
  const runtimeIgnoreStock = options.runtimeSlot?.ignoreStock ?? ignoreStock;
  const useRuntimeState = options.scope === "runtime-state";

  return {
    storageGroupId: options.storageGroup.id,
    groupIndex: options.groupIndex,
    slotId: options.slot.id,
    slotIndex: options.slotIndex,
    displayIndex: options.displayIndex,
    itemPath: `${basePath}.initialItemType`,
    countPath: `${basePath}.initialCount`,
    ignoreStockPath: `${basePath}.ignoreStock`,
    capacity,
    count: useRuntimeState ? runtimeCount : count,
    ignoreStock: useRuntimeState ? runtimeIgnoreStock : ignoreStock,
    lockItemId,
    initialItemType,
    displayItemId: useRuntimeState ? runtimeItemType : initialItemType ?? lockItemId,
    domain: resolveSlotDomain(options.storageGroup, effectiveItemFilterType),
    source: options.scope,
  };
}

function createRuntimeSlotKey(storageGroupId: string, slotId: string): string {
  return `${storageGroupId}:${slotId}`;
}

function readNumberOverride(
  config: WorldEntity["config"],
  path: string,
  fallback: number,
): number {
  const value = config[path];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readNullableStringOverride(
  config: WorldEntity["config"],
  path: string,
  fallback: string | null,
): string | null {
  const value = config[path];

  if (value === null) {
    return null;
  }

  return typeof value === "string" ? value : fallback;
}

function readBooleanOverride(
  config: WorldEntity["config"],
  path: string,
  fallback: boolean,
): boolean {
  const value = config[path];
  return typeof value === "boolean" ? value : fallback;
}

function readFilterTypeOverride(
  config: WorldEntity["config"],
  path: string,
  fallback: StorageSlotDefinition["itemFilterType"],
): StorageSlotDefinition["itemFilterType"] {
  const value = config[path];
  return value === "solid" || value === "liquid" || value === "gas" || value === "fluid" || value === "any"
    ? value
    : fallback;
}

function resolveSlotDomain(
  storageGroup: StorageSlotGroupDefinition,
  itemFilterType: StorageSlotDefinition["itemFilterType"],
): InspectorItemDomainFilter {
  if (
    itemFilterType === "solid"
    || itemFilterType === "liquid"
    || itemFilterType === "gas"
    || itemFilterType === "fluid"
    || itemFilterType === "any"
  ) {
    return itemFilterType;
  }
  if (storageGroup.kind === "fluid") {
    return "liquid";
  }
  if (storageGroup.kind === "item") {
    return "solid";
  }
  return "any";
}

function resolveItemIconSrc(item: ItemDefinition): string {
  return createItemIconAssetUrl(item.iconId);
}

function canSelectItemForRow(
  item: ItemDefinition,
  row: EffectiveSlotRow,
  rows: readonly EffectiveSlotRow[],
  resolveItemDomain: (itemId: string) => ReturnType<AppHost["workspace"]["registry"]["queries"]["resolveItemDomain"]>,
): boolean {
  if (!matchesItemDomain(item, row.domain, resolveItemDomain)) {
    return false;
  }

  if (item.id === row.displayItemId) {
    return true;
  }

  return !rows.some((candidate) =>
    candidate.slotIndex !== row.slotIndex && candidate.displayItemId === item.id,
  );
}

// AI-CORRECTION 2026-05-16: domain 判定统一委托 RegistryQuery.isItemLiquid，不再本地推断。
// AI-CORRECTION 2026-07-10: domain 判定升级为 resolveItemDomain，支持 gas 与 fluid。
function matchesItemDomain(
  item: ItemDefinition,
  domain: EffectiveSlotRow["domain"],
  resolveItemDomain: (itemId: string) => ReturnType<AppHost["workspace"]["registry"]["queries"]["resolveItemDomain"]>,
): boolean {
  return matchesItemDomainFilter(item, domain, resolveItemDomain);
}

function clampCount(value: number, capacity: number): number {
  const safeCapacity = Number.isFinite(capacity) ? Math.max(0, Math.trunc(capacity)) : 0;
  const safeValue = Number.isFinite(value) ? Math.trunc(value) : 0;
  return Math.min(Math.max(safeValue, 0), safeCapacity);
}
