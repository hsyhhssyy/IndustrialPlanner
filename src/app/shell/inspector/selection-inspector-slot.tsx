import { useCallback, useEffect, useState } from "react";
import { runInAction } from "mobx";

import type { AppHost } from "@/app/host/app-host";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type {
  EntityInspectorDeclaration,
  EntityInspectorType,
  RecipeStatusInspectorDeclaration,
} from "@/domain/registry/types/entity-inspector";
import { INSPECTOR_TYPE } from "@/domain/registry/types/entity-inspector";
import type { SimulationDeviceRuntimeStatusReadModel } from "@/domain/simulation/types/simulation-types";
import {
  buildProductionPlanningIndex,
} from "@/app/shell/production-planning/production-planning-model";
import {
  InspectorDataScopeContext,
  type InspectorDataScope,
} from "./selection-inspector-model";

import { SelectionInspectorActionStrip } from "./selection-inspector-action-strip";
import { SELECTION_LOGISTICS_SEGMENT_BUTTON_IDS } from "./selection-inspector-action-strip";
import { SimulationRecipeStatusRuntimeInspector } from "./simulation-recipe-status-runtime-inspector";
import { SlotConfigInspector } from "./slot-config-inspector";
import { WarehouseItemLinkInspector } from "./warehouse-item-link-inspector";
import { DarkPipeLinkInspector } from "./dark-pipe-link-inspector";
import { SubmitToWarehouseInspector } from "./submit-to-warehouse-inspector";
import { ProblemInspector } from "./problem-inspector";
import { PortOutputConfigInspector } from "./port-output-config-inspector";
import { PortPriorityGroupInspector } from "./port-priority-group-inspector";
import {
  canConfigurePortPriorityGroups,
} from "./port-priority-group-model";
import { AdmissionRuleInspector } from "./admission-rule-inspector";
import { BlockageAutoClearanceInspector } from "./blockage-auto-clearance-inspector";
import { LogisticsItemInspector } from "./logistics-item-inspector";
import { InspectorCollapsiblePanel } from "./inspector-collapsible-panel";
import { WaterPurifierNodeInspector } from "./water-purifier-node-inspector";
import { MeteredConsumptionInspector } from "./metered-consumption-inspector";
import { CanvasFloatingToolbarButtonStrip } from "@/app/shell/shared/canvas-floating-toolbar-button-strip";
import {
  findDarkPipeSlotLinkForEntity,
  resolveDarkPipeRole,
} from "@/shared/dark-pipe-link";
import { CONSUMPTION_RECIPE_TAG } from "@/shared/consumption-channel";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

const INSPECTOR_SLOT_INTERVAL_MS = 50;

type Translate = (key: string) => string;

interface InspectorDescriptor {
  id: string;
  declaration: EntityInspectorDeclaration;
}

interface InspectorSlotState {
  selectedEntity: WorldEntity;
  selectedDefinition: EntityDefinition;
  inspectors: InspectorDescriptor[];
  simulationRuntimeStatus: SimulationDeviceRuntimeStatusReadModel | null;
  showSimulationRuntimeInspector: boolean;
  debugEntityJson: string | null;
}

const INSPECTOR_LABELS: Partial<Record<EntityInspectorType, string>> = {
  [INSPECTOR_TYPE.genericDevice]: "设备概览",
  [INSPECTOR_TYPE.runtimeStatistics]: "运行统计",
  [INSPECTOR_TYPE.meteredConsumption]: "运行消耗",
  [INSPECTOR_TYPE.logisticsItem]: "物流物品",
  [INSPECTOR_TYPE.storageManagement]: "缓存管理",
  [INSPECTOR_TYPE.storageTypeFilter]: "缓存类型过滤",
  [INSPECTOR_TYPE.portFilter]: "端口过滤器",
  [INSPECTOR_TYPE.admissionRule]: "物品准入",
  [INSPECTOR_TYPE.submitToWarehouse]: "定时提交到仓库",
  [INSPECTOR_TYPE.slotConfig]: "槽位配置",
  [INSPECTOR_TYPE.linkConfig]: "链接配置",
  [INSPECTOR_TYPE.routing]: "分流/优先级",
  [INSPECTOR_TYPE.structure]: "结构配置",
  [INSPECTOR_TYPE.behaviorToggle]: "行为开关",
  [INSPECTOR_TYPE.warehouseItemLink]: "仓库物品链接",
  [INSPECTOR_TYPE.portOutputConfig]: "输出端口配置",
  [INSPECTOR_TYPE.darkPipeLink]: "暗管链接",
  [INSPECTOR_TYPE.waterPurifierNode]: "净水节点",
  [INSPECTOR_TYPE.blockageAutoClearance]: "自动处理复数配方阻塞",
};

function EmptyInspector({
  declaration,
}: {
  declaration: EntityInspectorDeclaration;
}) {
  return (
    <InspectorCollapsiblePanel
      data-inspector-label={INSPECTOR_LABELS[declaration.type] ?? declaration.type}
      dataInspectorKey={declaration.type}
      title={INSPECTOR_LABELS[declaration.type] ?? declaration.type}
    >
      {/*
        AI-REMOVED 2026-05-26:
        Reason: inspector 卡片不再显示标题。
        Trigger: 槽位配置 inspector 需求要求所有 inspector 无标题和副标题。
        Evidence: 用户明确要求“所有inspector都没有标题和副标题”。
        Replacement: data-inspector-label 保留语义标签，卡片主体只显示有效内容。
        Risk: Low
        Human Review: Required

        Original code:
        <h4>{INSPECTOR_LABELS[declaration.type] ?? declaration.type}</h4>
      */}
      <p>该配置当前不可用。</p>
    </InspectorCollapsiblePanel>
  );
}

function renderRecipeStatusInspector(options: {
  appHost: AppHost;
  declaration: RecipeStatusInspectorDeclaration;
  entity: WorldEntity;
  definition: EntityDefinition;
  runtimeStatus: SimulationDeviceRuntimeStatusReadModel | null;
  translate: Translate;
}) {
  const registry = options.appHost.workspace.registry;
  const index = buildProductionPlanningIndex(registry);
  const debugMode = options.appHost.state.settings.debugMode === true;
  const channelIds = debugMode
    ? options.definition.recipeChannels.map((channel) => channel.id)
    : options.declaration.channelIds.filter((channelId) =>
        options.definition.recipeChannels.find((channel) => channel.id === channelId)?.type
          !== "consumption-channel",
      );
  if (debugMode) {
    for (const recipe of registry.recipeDefinitions) {
      if (recipe.tags.includes(CONSUMPTION_RECIPE_TAG)) {
        index.recipeById.set(recipe.id, recipe);
      }
    }
  }

  return (
    <SimulationRecipeStatusRuntimeInspector
      channelIds={channelIds}
      channels={options.definition.recipeChannels}
      runtimeStatus={options.runtimeStatus}
      index={index}
      t={options.translate}
      appHost={options.appHost}
      entity={options.entity}
      definition={options.definition}
    />
  );
}

function renderInspector(options: {
  appHost: AppHost;
  declaration: EntityInspectorDeclaration;
  entity: WorldEntity;
  definition: EntityDefinition;
  runtimeStatus: SimulationDeviceRuntimeStatusReadModel | null;
  translate: Translate;
}) {
  switch (options.declaration.type) {
    case INSPECTOR_TYPE.slotConfig:
      if (
        options.appHost.state.settings.debugMode !== true
        && options.declaration.slotGroupIds.length === 0
      ) {
        return null;
      }
      return (
        <SlotConfigInspector
          appHost={options.appHost}
          declaration={options.declaration}
          definition={options.definition}
          entity={options.entity}
          runtimeStatus={options.runtimeStatus}
          translate={options.translate}
        />
      );
    case INSPECTOR_TYPE.logisticsItem:
      return (
        <LogisticsItemInspector
          appHost={options.appHost}
          runtimeStatus={options.runtimeStatus}
          translate={options.translate}
        />
      );
    case INSPECTOR_TYPE.warehouseItemLink:
      if (isWarehouseItemLinkSuppressedByDarkPipeLink(options)) {
        return null;
      }

      return (
        <WarehouseItemLinkInspector
          appHost={options.appHost}
          declaration={options.declaration}
          definition={options.definition}
          entity={options.entity}
          translate={options.translate}
        />
      );
    case INSPECTOR_TYPE.darkPipeLink:
      return (
        <DarkPipeLinkInspector
          appHost={options.appHost}
          definition={options.definition}
          entity={options.entity}
        />
      );
    case INSPECTOR_TYPE.submitToWarehouse:
      return (
        <SubmitToWarehouseInspector
          appHost={options.appHost}
          entity={options.entity}
          definition={options.definition}
          runtimeStatus={options.runtimeStatus}
          translate={options.translate}
        />
      );
    case INSPECTOR_TYPE.recipeStatus:
      return renderRecipeStatusInspector({
        ...options,
        declaration: options.declaration as RecipeStatusInspectorDeclaration,
      });
    case INSPECTOR_TYPE.problem:
      return (
        <ProblemInspector
          appHost={options.appHost}
          entity={options.entity}
          definition={options.definition}
          runtimeStatus={options.runtimeStatus}
        />
      );
    case INSPECTOR_TYPE.portOutputConfig:
      return (
        <PortOutputConfigInspector
          appHost={options.appHost}
          declaration={options.declaration}
          entity={options.entity}
          definition={options.definition}
          translate={options.translate}
        />
      );
    case INSPECTOR_TYPE.admissionRule:
      return (
        <AdmissionRuleInspector
          appHost={options.appHost}
          declaration={options.declaration}
          entity={options.entity}
          definition={options.definition}
          runtimeStatus={options.runtimeStatus}
          translate={options.translate}
        />
      );
    case INSPECTOR_TYPE.waterPurifierNode:
      return (
        <WaterPurifierNodeInspector
          appHost={options.appHost}
          entity={options.entity}
          definition={options.definition}
        />
      );
    case INSPECTOR_TYPE.blockageAutoClearance:
      return (
        <BlockageAutoClearanceInspector
          appHost={options.appHost}
          entity={options.entity}
          definition={options.definition}
        />
      );
    case INSPECTOR_TYPE.meteredConsumption:
      return (
        <MeteredConsumptionInspector
          appHost={options.appHost}
          definition={options.definition}
          entity={options.entity}
          runtimeStatus={options.runtimeStatus}
        />
      );
    default:
      return <EmptyInspector declaration={options.declaration} />;
  }
}

function isWarehouseItemLinkSuppressedByDarkPipeLink(options: {
  appHost: AppHost;
  entity: WorldEntity;
  definition: EntityDefinition;
}): boolean {
  if (resolveDarkPipeRole(options.definition.id) !== "outlet") {
    return false;
  }

  const documentSnapshot = options.appHost.workspace.editor?.document.getSnapshot() ?? null;
  if (documentSnapshot === null) {
    return false;
  }

  return findDarkPipeSlotLinkForEntity(documentSnapshot, options.entity.id) !== null;
}

// AI-REMOVED 2026-05-31:
// Reason: InspectorScopeCard（编辑模式切换 UI）被删除，scope 改为 inspector 级别管理。
// Trigger: 设计需求将 scope 从设备级别改为 inspector 级别，每个子 inspector 独立持有自己的 scope。
// Evidence: 当前无 UI 暴露 scope 切换入口，后续由用户自行添加 per-inspector 的 toggle UI。
// Replacement: 每个 inspector 的 scope 由 SelectionInspectorSlot 内 scopeByInspectorId 管理，通过 per-inspector Provider 注入。
// Risk: Low
// Human Review: Not required — UI 暂缺是预期行为。
//
// Original code:
// function InspectorScopeCard({
//   scope,
//   simulationRunning,
//   onScopeChange,
// }: {
//   scope: InspectorDataScope;
//   simulationRunning: boolean;
//   onScopeChange: (scope: InspectorDataScope) => void;
// }) {
//   return (
//     <article
//       className={cm(styles, "definition-card inspector-expanded-panel inspector-scope-card")}
//       data-inspector-key="data-scope"
//     >
//       <div className={cm(styles, "inspector-expanded-header")}>
//         <span>编辑模式</span>
//       </div>
//       <div className={cm(styles, "inspector-scope-toggle")} role="group">
//         <button
//           className={cm(styles, scope === "initial-config" ? "is-selected" : "")}
//           data-inspector-scope="initial-config"
//           onClick={() => onScopeChange("initial-config")}
//           type="button"
//         >
//           初始配置
//         </button>
//         <button
//           className={cm(styles, scope === "runtime-state" ? "is-selected" : "")}
//           data-inspector-scope="runtime-state"
//           disabled={!simulationRunning}
//           onClick={() => onScopeChange("runtime-state")}
//           type="button"
//         >
//           当前状态
//         </button>
//       </div>
//     </article>
//   );
// }

function resolveSelectedDeviceLabel(
  definition: EntityDefinition,
  translate: Translate,
): string {
  const translated = translate(definition.nameKey);

  return translated === definition.nameKey ? definition.id : translated;
}

function SelectionInspectorDeviceHeader({
  appHost,
  selectedDefinition,
  selectedEntity,
  translate,
}: {
  appHost: AppHost;
  selectedDefinition: EntityDefinition;
  selectedEntity: WorldEntity;
  translate: Translate;
}) {
  const handleDeviceNameClick = useCallback(() => {
    const wikiState = appHost.internalState.workbench.toolbox.wiki;

    appHost.internalActions.openDialog("toolbox");
    appHost.internalActions.setDialogTab("toolbox", "item-encyclopedia");

    runInAction(() => {
      wikiState.navigationStack = [{ type: "entity", id: selectedDefinition.id }];
      wikiState.openedPage = { kind: "entity", id: selectedDefinition.id };
    });
  }, [appHost, selectedDefinition.id]);

  return (
    <section className={cm(styles, "selection-inspector-device-header")}>
      <div
        className={cm(styles, "selection-inspector-device-copy")}
        onClick={handleDeviceNameClick}
        role="button"
        tabIndex={0}
      >
        <div className={cm(styles, "selection-inspector-device-title-row")}>
          <h3>{resolveSelectedDeviceLabel(selectedDefinition, translate)}</h3>
        </div>
        <p>{selectedEntity.id}</p>
      </div>
      <SelectionInspectorActionStrip appHost={appHost} variant="inline" />
    </section>
  );
}

export function SelectionInspectorSlot({
  appHost,
  translate,
}: {
  appHost: AppHost;
  translate: Translate;
}) {
  const [slotState, setSlotState] = useState<InspectorSlotState | null>(null);
  const [scopeByInspectorId, setScopeByInspectorId] = useState<Record<string, InspectorDataScope>>({});

  useEffect(() => {
    const hideSlot = () => {
      setSlotState((current) => current === null ? current : null);
    };

    const tick = () => {
      const editor = appHost.workspace.editor;

      if (editor === null) {
        hideSlot();
        return;
      }

      const selection = [...editor.state.collections.selection];

      if (selection.length !== 1) {
        hideSlot();
        return;
      }

      const selectedEntityId = selection[0];

      if (selectedEntityId === undefined) {
        hideSlot();
        return;
      }

      const selectedEntity = editor.queries.getEntityById(selectedEntityId);

      if (selectedEntity === null || selectedEntity === undefined) {
        hideSlot();
        return;
      }

      const selectedDefinition = appHost.workspace.registry.entityDefinitions.find(
        (definition) => definition.id === selectedEntity.definitionId,
      );

      if (selectedDefinition === undefined) {
        hideSlot();
        return;
      }

      const inspectorDeclarations = selectedDefinition.inspectors;
      const inspectors = inspectorDeclarations.map((declaration, declarationIndex) => {
        const id = [
          selectedEntity.id,
          declaration.type,
          resolveInspectorDiscriminator(declaration, declarationIndex),
        ].join(":");

        return {
          id,
          declaration,
        };
      });
      const simulation = appHost.workspace.simulation;
      const showSimulationRuntimeInspector = simulation !== null && simulation.state.runningState !== "stop";
      if (!showSimulationRuntimeInspector) {
        setScopeByInspectorId((current) => Object.keys(current).length === 0 ? current : {});
      }

      setSlotState({
        selectedEntity,
        selectedDefinition,
        inspectors,
        simulationRuntimeStatus: showSimulationRuntimeInspector
          ? simulation?.queries.getDeviceRuntimeStatus(selectedEntity.id) ?? null
          : null,
        showSimulationRuntimeInspector,
        debugEntityJson: appHost.state.settings.debugMode
          ? JSON.stringify(selectedEntity, null, 2)
          : null,
      });
    };

    tick();
    const intervalId = window.setInterval(tick, INSPECTOR_SLOT_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [appHost]);

  if (slotState === null) {
    return null;
  }



  return (
    <div
      className={cm(styles, "cluster")}
      data-selected-definition-id={slotState.selectedDefinition.id}
      data-selected-entity-id={slotState.selectedEntity.id}
      data-selection-inspector-slot
    >
      <SelectionInspectorDeviceHeader
        appHost={appHost}
        selectedDefinition={slotState.selectedDefinition}
        selectedEntity={slotState.selectedEntity}
        translate={translate}
      />
      {/*
        AI-REMOVED 2026-05-26:
        Reason: inspector 容器不再显示统一标题。
        Trigger: 槽位配置 inspector 需求要求所有 inspector 无标题和副标题。
        Evidence: 用户明确要求"注意所有inspector都没有标题和副标题！现有的需要修改。"
        Replacement: InspectorScopeCard 提供模式切换，具体 inspector 直接显示主体内容。
        Risk: Low
        Human Review: Required

        Original code:
        <div className={cm(styles, "card-header card-subheader")}>
          <h4>{translate("section.runtimeDetails")}</h4>
        </div>
      */}
      {/*
        AI-CORRECTION 2026-05-31:
        Reason: InspectorScopeCard（上述 Replacement）已被删除，scope 改为 inspector 级别管理，不再使用全局 scope toggle。
        Trigger: 设计需求将 scope 从设备级别改为 inspector 级别。
      */}
      <div className={cm(styles, "definition-list")}>
        {(() => {
          const renderedInspectors = slotState.inspectors.flatMap((inspector) => {
            const inspectorScope = slotState.showSimulationRuntimeInspector
              ? scopeByInspectorId[inspector.id] ?? "runtime-state"
              : "initial-config";
            const renderedInspector = renderInspector({
              appHost,
              declaration: inspector.declaration,
              entity: slotState.selectedEntity,
              definition: slotState.selectedDefinition,
              runtimeStatus: slotState.simulationRuntimeStatus,
              translate,
            });

            if (renderedInspector === null) {
              return [];
            }

            return [(
              <InspectorDataScopeContext.Provider
                key={inspector.id}
                value={{
                  scope: inspectorScope,
                  simulationRunning: slotState.showSimulationRuntimeInspector,
                  canUseRuntimeState: slotState.showSimulationRuntimeInspector,
                  setScope: (nextScope: InspectorDataScope) => {
                    if (!slotState.showSimulationRuntimeInspector && nextScope === "runtime-state") {
                      return;
                    }

                    setScopeByInspectorId((current) => ({
                      ...current,
                      [inspector.id]: nextScope,
                    }));
                  },
                }}
              >
                <div>
                  {renderedInspector}
                </div>
              </InspectorDataScopeContext.Provider>
            )];
          });
          const portPriorityInspector = canConfigurePortPriorityGroups(slotState.selectedDefinition)
            ? (
                <PortPriorityGroupInspector
                  appHost={appHost}
                  definition={slotState.selectedDefinition}
                  entity={slotState.selectedEntity}
                  key="port-priority-group"
                />
              )
            : null;
          const renderedInspectorsWithBehaviors = portPriorityInspector === null
            ? renderedInspectors
            : [...renderedInspectors, portPriorityInspector];

          const isDedicatedLogistics = appHost.workspace.registry.queries.isDedicatedLogisticsDevice(
            slotState.selectedDefinition.id,
          );

          if (isDedicatedLogistics && renderedInspectorsWithBehaviors.length > 0) {
            return [
              renderedInspectorsWithBehaviors[0],
              <div
                key="logistics-segment-delete"
                className={cm(styles, "selection-inspector-action-button-list")}
                style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}
              >
                <CanvasFloatingToolbarButtonStrip
                  appHost={appHost}
                  buttonClassName={cm(styles, "selection-inspector-action-button")}
                  buttonIds={SELECTION_LOGISTICS_SEGMENT_BUTTON_IDS}
                  iconClassName={cm(styles, "selection-inspector-action-icon")}
                  labelClassName={cm(styles, "selection-inspector-action-label")}
                  showLabels
                />
              </div>,
              ...renderedInspectorsWithBehaviors.slice(1),
            ];
          }

          return renderedInspectorsWithBehaviors;
        })()}
        {slotState.debugEntityJson !== null ? (
          <article className={cm(styles, "definition-card")} data-inspector-key="json-debug">
            {/*
              AI-REMOVED 2026-05-26:
              Reason: debug inspector 也遵循无标题规则。
              Trigger: 槽位配置 inspector 需求要求所有 inspector 无标题和副标题。
              Evidence: 用户明确要求"所有inspector都没有标题和副标题"。
              Replacement: textarea 本身提供调试内容。
              Risk: Low
              Human Review: Required

              Original code:
              <h4>JSON Debug</h4>
            */}
            <textarea
              className={cm(styles, "json-debug-textarea")}
              readOnly
              value={slotState.debugEntityJson}
              rows={20}
            />
          </article>
        ) : null}
      </div>
    </div>
  );
}

function resolveInspectorDiscriminator(
  declaration: EntityInspectorDeclaration,
  fallbackIndex: number,
): string {
  switch (declaration.type) {
    case INSPECTOR_TYPE.slotConfig:
      return declaration.slotGroupIds.join(",");
    case INSPECTOR_TYPE.warehouseItemLink:
      return [
        ...declaration.slotGroupIds,
        ...(declaration.slotIds ?? []),
      ].join(",");
    case INSPECTOR_TYPE.darkPipeLink:
      return "dark-pipe-link";
    case INSPECTOR_TYPE.portFilter:
    case INSPECTOR_TYPE.routing:
      return declaration.portRef;
    case INSPECTOR_TYPE.admissionRule:
      return `${declaration.portGroupId}:${declaration.portId}`;
    case INSPECTOR_TYPE.linkConfig:
      return String(declaration.cacheLinkIndex);
    case INSPECTOR_TYPE.portOutputConfig:
      return declaration.portGroupIds.join(",");
    case INSPECTOR_TYPE.waterPurifierNode:
      return "water-purifier-node";
    case INSPECTOR_TYPE.blockageAutoClearance:
      return "blockage-auto-clearance";
    case INSPECTOR_TYPE.meteredConsumption:
      return "metered-consumption";
    default:
      return String(fallbackIndex);
  }
}

/*
  AI-REMOVED 2026-05-30:
  Reason: 显式 SimulationRecipeStatusRuntimeInspector 渲染块已删除，recipeStatus 统一由 inspector 声明循环渲染。
  Trigger: 反应池在仿真运行时显示两个配方选择器（显式块 + 声明循环各渲染一次）。
  Evidence: 显式块仅在 showSimulationRuntimeInspector 时渲染，声明循环始终渲染，导致仿真时 double。
  Replacement: inspector 声明循环（renderInspector → renderRecipeStatusInspector）已覆盖全部场景。
  Risk: Low
  Human Review: Required

  Original code:
  function collectRecipeStatusChannelIds(
    declarations: readonly EntityInspectorDeclaration[],
  ): readonly string[] {
    const ids = new Set<string>();
    for (const d of declarations) {
      if (d.type === INSPECTOR_TYPE.recipeStatus) {
        for (const chId of d.channelIds) {
          ids.add(chId);
        }
      }
    }
    return [...ids];
  }
*/
