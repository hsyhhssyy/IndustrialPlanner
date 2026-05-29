import { useEffect, useState } from "react";

import type { AppHost } from "@/app/host/app-host";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type {
  EntityInspectorDeclaration,
  EntityInspectorType,
} from "@/domain/registry/types/entity-inspector";
import { INSPECTOR_TYPE } from "@/domain/registry/types/entity-inspector";
import type { SimulationDeviceRuntimeStatusReadModel } from "@/domain/simulation/types/simulation-types";
import {
  buildProductionPlanningIndex,
  type ProductionPlanningIndex,
} from "@/app/shell/production-planning/production-planning-model";
import {
  InspectorDataScopeContext,
  type InspectorDataScope,
} from "./selection-inspector-model";

import { SimulationRecipeStatusRuntimeInspector } from "./simulation-recipe-status-runtime-inspector";
import { SlotConfigInspector } from "./slot-config-inspector";
import { WarehouseItemLinkInspector } from "./warehouse-item-link-inspector";
import { RecipeConfigInspector } from "./recipe-config-inspector";
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
  recipeChannelIds: readonly string[];
  productionPlanningIndex: ProductionPlanningIndex | null;
  debugEntityJson: string | null;
}

const INSPECTOR_LABELS: Partial<Record<EntityInspectorType, string>> = {
  [INSPECTOR_TYPE.genericDevice]: "设备概览",
  [INSPECTOR_TYPE.runtimeStatistics]: "运行统计",
  [INSPECTOR_TYPE.storageManagement]: "缓存管理",
  [INSPECTOR_TYPE.storageTypeFilter]: "缓存类型过滤",
  [INSPECTOR_TYPE.portFilter]: "端口过滤器",
  [INSPECTOR_TYPE.recipeConfig]: "配方配置",
  [INSPECTOR_TYPE.slotConfig]: "槽位配置",
  [INSPECTOR_TYPE.linkConfig]: "链接配置",
  [INSPECTOR_TYPE.routing]: "分流/优先级",
  [INSPECTOR_TYPE.structure]: "结构配置",
  [INSPECTOR_TYPE.behaviorToggle]: "行为开关",
  [INSPECTOR_TYPE.warehouseItemLink]: "仓库物品链接",
};

function EmptyInspector({
  declaration,
}: {
  declaration: EntityInspectorDeclaration;
}) {
  return (
    <article
      className={cm(styles, "definition-card")}
      data-inspector-key={declaration.type}
      data-inspector-label={INSPECTOR_LABELS[declaration.type] ?? declaration.type}
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
    </article>
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
    case INSPECTOR_TYPE.warehouseItemLink:
      return (
        <WarehouseItemLinkInspector
          appHost={options.appHost}
          declaration={options.declaration}
          definition={options.definition}
          entity={options.entity}
          translate={options.translate}
        />
      );
    case INSPECTOR_TYPE.recipeConfig:
      return (
        <RecipeConfigInspector
          appHost={options.appHost}
          entity={options.entity}
          definition={options.definition}
          runtimeStatus={options.runtimeStatus}
          translate={options.translate}
        />
      );
    default:
      return <EmptyInspector declaration={options.declaration} />;
  }
}

function InspectorScopeCard({
  scope,
  simulationRunning,
  onScopeChange,
}: {
  scope: InspectorDataScope;
  simulationRunning: boolean;
  onScopeChange: (scope: InspectorDataScope) => void;
}) {
  return (
    <article
      className={cm(styles, "definition-card inspector-scope-card")}
      data-inspector-key="data-scope"
    >
      <div className={cm(styles, "inspector-scope-toggle")} role="group">
        <button
          className={cm(styles, scope === "initial-config" ? "is-selected" : "")}
          data-inspector-scope="initial-config"
          onClick={() => onScopeChange("initial-config")}
          type="button"
        >
          初始配置
        </button>
        <button
          className={cm(styles, scope === "runtime-state" ? "is-selected" : "")}
          data-inspector-scope="runtime-state"
          disabled={!simulationRunning}
          onClick={() => onScopeChange("runtime-state")}
          type="button"
        >
          当前状态
        </button>
      </div>
    </article>
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
  const [scopeByEntityId, setScopeByEntityId] = useState<Record<string, InspectorDataScope>>({});

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
        setScopeByEntityId((current) => Object.keys(current).length === 0 ? current : {});
      }

      const recipeChannelIds = showSimulationRuntimeInspector
        ? collectRecipeStatusChannelIds(inspectorDeclarations)
        : [];

      const productionPlanningIndex = showSimulationRuntimeInspector
        ? buildProductionPlanningIndex(appHost.workspace.registry)
        : null;

      setSlotState({
        selectedEntity,
        selectedDefinition,
        inspectors,
        simulationRuntimeStatus: showSimulationRuntimeInspector
          ? simulation?.queries.getDeviceRuntimeStatus(selectedEntity.id) ?? null
          : null,
        showSimulationRuntimeInspector,
        recipeChannelIds,
        productionPlanningIndex,
        debugEntityJson: appHost.state.settings.debugMode
          ? JSON.stringify(selectedEntity, null, 2)
          : null,
      });
    };

    const intervalId = window.setInterval(tick, INSPECTOR_SLOT_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [appHost]);

  if (slotState === null) {
    return null;
  }

  const selectedScope = slotState.showSimulationRuntimeInspector
    ? scopeByEntityId[slotState.selectedEntity.id] ?? "runtime-state"
    : "initial-config";
  const scopeContext = {
    scope: selectedScope,
    simulationRunning: slotState.showSimulationRuntimeInspector,
    canUseRuntimeState: slotState.showSimulationRuntimeInspector,
    setScope: (nextScope: InspectorDataScope) => {
      if (!slotState.showSimulationRuntimeInspector && nextScope === "runtime-state") {
        return;
      }

      setScopeByEntityId((current) => ({
        ...current,
        [slotState.selectedEntity.id]: nextScope,
      }));
    },
  };

  return (
    <div
      className={cm(styles, "cluster")}
      data-selected-definition-id={slotState.selectedDefinition.id}
      data-selected-entity-id={slotState.selectedEntity.id}
      data-selection-inspector-slot
    >
      {/*
        AI-REMOVED 2026-05-26:
        Reason: inspector 容器不再显示统一标题。
        Trigger: 槽位配置 inspector 需求要求所有 inspector 无标题和副标题。
        Evidence: 用户明确要求“注意所有inspector都没有标题和副标题！现有的需要修改。”
        Replacement: InspectorScopeCard 提供模式切换，具体 inspector 直接显示主体内容。
        Risk: Low
        Human Review: Required

        Original code:
        <div className={cm(styles, "card-header card-subheader")}>
          <h4>{translate("section.runtimeDetails")}</h4>
        </div>
      */}
      <InspectorDataScopeContext.Provider value={scopeContext}>
        <div className={cm(styles, "definition-list")}>
          <InspectorScopeCard
            scope={selectedScope}
            simulationRunning={slotState.showSimulationRuntimeInspector}
            onScopeChange={scopeContext.setScope}
          />
          {slotState.recipeChannelIds.map((channelId) => (
            <SimulationRecipeStatusRuntimeInspector
              key={channelId}
              channelId={channelId}
              runtimeStatus={slotState.simulationRuntimeStatus}
              index={slotState.productionPlanningIndex!}
              t={translate}
            />
          ))}
          {slotState.inspectors.map((inspector) => (
            <div
              key={inspector.id}
            >
              {renderInspector({
                appHost,
                declaration: inspector.declaration,
                entity: slotState.selectedEntity,
                definition: slotState.selectedDefinition,
                runtimeStatus: slotState.simulationRuntimeStatus,
                translate,
              })}
            </div>
          ))}
          {slotState.debugEntityJson !== null ? (
            <article className={cm(styles, "definition-card")} data-inspector-key="json-debug">
              {/*
                AI-REMOVED 2026-05-26:
                Reason: debug inspector 也遵循无标题规则。
                Trigger: 槽位配置 inspector 需求要求所有 inspector 无标题和副标题。
                Evidence: 用户明确要求“所有inspector都没有标题和副标题”。
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
      </InspectorDataScopeContext.Provider>
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
    case INSPECTOR_TYPE.portFilter:
    case INSPECTOR_TYPE.routing:
      return declaration.portRef;
    case INSPECTOR_TYPE.linkConfig:
      return String(declaration.cacheLinkIndex);
    default:
      return String(fallbackIndex);
  }
}

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
