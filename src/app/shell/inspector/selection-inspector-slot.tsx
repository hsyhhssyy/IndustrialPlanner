import { useEffect, useState } from "react";

import type { AppHost } from "@/app/host/app-host";
import type { InspectorType } from "@/domain/types/registry/inspector-types";
import { INSPECTOR_TYPE } from "@/domain/types/registry/inspector-types";

const INSPECTOR_SLOT_INTERVAL_MS = 50;

type Translate = (key: string) => string;

interface InspectorQueryResult {
  key: InspectorType;
  name: string;
  ticks: number;
}

interface MountedInspector {
  query: () => InspectorQueryResult;
}

interface InspectorSlotState {
  selectedEntityId: string;
  selectedDefinitionId: string;
  inspectors: InspectorQueryResult[];
}

const INSPECTOR_LABELS: Record<InspectorType, string> = {
  [INSPECTOR_TYPE.portFilter]: "端口过滤器",
  [INSPECTOR_TYPE.recipeConfig]: "配方配置",
  [INSPECTOR_TYPE.slotConfig]: "槽位配置",
  [INSPECTOR_TYPE.linkConfig]: "链接配置",
  [INSPECTOR_TYPE.routing]: "分流/优先级",
  [INSPECTOR_TYPE.structure]: "结构配置",
  [INSPECTOR_TYPE.behaviorToggle]: "行为开关",
};

function mountEmptyInspector(key: InspectorType): MountedInspector {
  let ticks = 0;

  return {
    query: () => {
      ticks += 1;

      return {
        key,
        name: INSPECTOR_LABELS[key],
        ticks,
      };
    },
  };
}

function EmptyInspector({
  result,
}: {
  result: InspectorQueryResult;
}) {
  return (
    <article className="definition-card" data-inspector-key={result.key}>
      <h4>{result.name}</h4>
      <p>{`tick ${result.ticks}`}</p>
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

  useEffect(() => {
    const mountedInspectors = new Map<string, MountedInspector>();

    const hideSlot = () => {
      mountedInspectors.clear();
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

      const selectedEntity =
        editor.document.getSnapshot().entities[selectedEntityId]
        ?? editor.queries.getEntityById(selectedEntityId);

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

      const inspectorKeys = (
        Object.keys(selectedDefinition.inspectors) as (keyof typeof selectedDefinition.inspectors)[]
      ).filter((k) => selectedDefinition.inspectors[k] !== undefined);

      const nextInstanceIds = new Set<string>();
      const inspectors = inspectorKeys.map((propKey) => {
        const inspectorKey = INSPECTOR_TYPE[propKey];
        const instanceId = `${selectedEntity.id}:${inspectorKey}`;
        const mountedInspector =
          mountedInspectors.get(instanceId)
          ?? mountEmptyInspector(inspectorKey);

        mountedInspectors.set(instanceId, mountedInspector);
        nextInstanceIds.add(instanceId);

        return mountedInspector.query();
      });

      for (const instanceId of mountedInspectors.keys()) {
        if (!nextInstanceIds.has(instanceId)) {
          mountedInspectors.delete(instanceId);
        }
      }

      setSlotState({
        selectedEntityId: selectedEntity.id,
        selectedDefinitionId: selectedDefinition.id,
        inspectors,
      });
    };

    const intervalId = window.setInterval(tick, INSPECTOR_SLOT_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
      mountedInspectors.clear();
    };
  }, [appHost]);

  if (slotState === null) {
    return null;
  }

  return (
    <div
      className="cluster"
      data-selected-definition-id={slotState.selectedDefinitionId}
      data-selected-entity-id={slotState.selectedEntityId}
      data-selection-inspector-slot
    >
      <div className="card-header card-subheader">
        <h4>{translate("section.runtimeDetails")}</h4>
      </div>
      <div className="definition-list">
        {slotState.inspectors.map((inspector) => (
          <EmptyInspector
            key={`${slotState.selectedEntityId}:${inspector.key}`}
            result={inspector}
          />
        ))}
      </div>
    </div>
  );
}
