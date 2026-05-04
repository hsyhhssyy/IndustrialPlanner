import { useEffect, useState } from "react";

import type { AppHost } from "@/app/host/app-host";
import type { WorldEntity } from "@/domain/entity/world-document";
import type { EntityDefinition } from "@/domain/types/registry/entity-definition";
import type {
  EntityInspectorDeclaration,
  EntityInspectorType,
} from "@/domain/types/registry/entity-inspector";
import { INSPECTOR_TYPE } from "@/domain/types/registry/entity-inspector";
import type { SimulationDeviceRuntimeStatus } from "@/domain/types/simulation";

import { SimulationRuntimeInspector } from "./simulation-runtime-inspector";
import { SlotConfigInspector } from "./slot-config-inspector";

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
  simulationRuntimeStatus: SimulationDeviceRuntimeStatus | null;
  showSimulationRuntimeInspector: boolean;
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
    <article className="definition-card" data-inspector-key={declaration.type}>
      <h4>{INSPECTOR_LABELS[declaration.type] ?? declaration.type}</h4>
      <p>该 inspector 尚未接入真实编辑器。</p>
    </article>
  );
}

function renderInspector(options: {
  appHost: AppHost;
  declaration: EntityInspectorDeclaration;
  entity: WorldEntity;
  definition: EntityDefinition;
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
          translate={options.translate}
        />
      );
    default:
      return <EmptyInspector declaration={options.declaration} />;
  }
}

export function SelectionInspectorSlot({
  appHost,
  translate,
}: {
  appHost: AppHost;
  translate: Translate;
}) {
  const [slotState, setSlotState] = useState<InspectorSlotState | null>(null);

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
          declaration.targetPath ?? declarationIndex,
        ].join(":");

        return {
          id,
          declaration,
        };
      });
      const simulation = appHost.workspace.simulation;
      const showSimulationRuntimeInspector = simulation?.state === "start";

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
      className="cluster"
      data-selected-definition-id={slotState.selectedDefinition.id}
      data-selected-entity-id={slotState.selectedEntity.id}
      data-selection-inspector-slot
    >
      <div className="card-header card-subheader">
        <h4>{translate("section.runtimeDetails")}</h4>
      </div>
      <div className="definition-list">
        {slotState.showSimulationRuntimeInspector ? (
          <SimulationRuntimeInspector
            runtimeStatus={slotState.simulationRuntimeStatus}
          />
        ) : null}
        {slotState.inspectors.map((inspector) => (
          <div
            key={inspector.id}
          >
            {renderInspector({
              appHost,
              declaration: inspector.declaration,
              entity: slotState.selectedEntity,
              definition: slotState.selectedDefinition,
              translate,
            })}
          </div>
        ))}
        {slotState.debugEntityJson !== null ? (
          <article className="definition-card" data-inspector-key="json-debug">
            <h4>JSON Debug</h4>
            <textarea
              className="json-debug-textarea"
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
