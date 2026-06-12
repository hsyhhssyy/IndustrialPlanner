import { useState } from "react";

import type { AppHost } from "@/app/host/app-host";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import {
  CUSTOM_PORT_PRIORITY_GROUPS_CONFIG_KEY,
  PORT_PRIORITY_GROUP_MAX,
  PORT_PRIORITY_GROUP_MIN,
  PORT_PRIORITY_GROUP_OVERRIDES_CONFIG_KEY,
  isCustomPortPriorityGroupsEnabled,
} from "@/shared/port-priority-groups";
import {
  resolveNextPortPriorityGroupOverrides,
  resolvePortPriorityGroupRows,
} from "@/app/shell/inspector/port-priority-group-model";
import { InspectorCollapsiblePanel } from "@/app/shell/inspector/inspector-collapsible-panel";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

const PRIORITY_GROUP_VALUES = Array.from(
  { length: PORT_PRIORITY_GROUP_MAX - PORT_PRIORITY_GROUP_MIN + 1 },
  (_, index) => PORT_PRIORITY_GROUP_MIN + index,
);

export function PortPriorityGroupInspector({
  appHost,
  entity,
  definition,
}: {
  readonly appHost: AppHost;
  readonly entity: WorldEntity;
  readonly definition: EntityDefinition;
}) {
  const [openPortKey, setOpenPortKey] = useState<string | null>(null);
  const customEnabled = isCustomPortPriorityGroupsEnabled(entity.config);
  const rows = resolvePortPriorityGroupRows(definition, entity);
  const deviceClass = appHost.state?.screenProfile?.deviceClass ?? "desktop";

  const patchEntityConfig = (patch: Record<string, unknown>) => {
    appHost.workspace.editor?.actions.patchEntityConfig(entity.id, patch);
  };

  const toggleCustom = (enabled: boolean) => {
    patchEntityConfig({
      [CUSTOM_PORT_PRIORITY_GROUPS_CONFIG_KEY]: enabled,
    });
    if (!enabled) {
      setOpenPortKey(null);
    }
  };

  const selectPriorityGroup = (portKey: string, priorityGroup: number) => {
    patchEntityConfig({
      [PORT_PRIORITY_GROUP_OVERRIDES_CONFIG_KEY]: resolveNextPortPriorityGroupOverrides(
        entity.config,
        portKey,
        priorityGroup,
      ),
    });
    setOpenPortKey(null);
  };

  return (
    <InspectorCollapsiblePanel
      bodyClassName="port-priority-panel-body"
      className="port-priority-group-inspector"
      data-device-class={deviceClass}
      dataInspectorKey="port-priority-group"
      headerActions={(
        <label className={cm(styles, "port-priority-custom-switch")}>
          <input
            checked={customEnabled}
            data-port-priority-custom-switch
            onChange={(event) => {
              toggleCustom(event.currentTarget.checked);
            }}
            role="switch"
            type="checkbox"
          />
          <span>自定义</span>
        </label>
      )}
      title="端口优先级组"
    >
      <div
        className={cm(styles, "port-priority-list")}
        data-port-priority-custom-enabled={customEnabled ? "true" : "false"}
      >
        {rows.map((row) => {
          const pickerOpen = customEnabled && openPortKey === row.portKey;

          return (
            <div
              className={cm(styles, "port-priority-row")}
              data-port-key={row.portKey}
              data-port-kind={row.portKind}
              key={row.portKey}
            >
              <span className={cm(styles, "port-priority-port-label")}>
                {row.portLabel}
              </span>
              <button
                aria-expanded={pickerOpen}
                aria-label={`${row.portLabel} 优先级组 ${row.priorityLabel}`}
                className={cm(styles, "port-priority-number-button")}
                data-port-priority-number={row.priorityLabel}
                disabled={!customEnabled}
                onClick={() => {
                  setOpenPortKey((current) =>
                    current === row.portKey ? null : row.portKey,
                  );
                }}
                title={`G${row.priorityLabel}`}
                type="button"
              >
                {row.priorityLabel}
              </button>
              {pickerOpen ? (
                <div
                  aria-label={`${row.portLabel} 优先级组选择`}
                  className={cm(styles, "port-priority-picker")}
                  role="group"
                >
                  {PRIORITY_GROUP_VALUES.map((priorityGroup) => (
                    <button
                      aria-pressed={priorityGroup === row.priorityGroup}
                      className={cm(
                        styles,
                        priorityGroup === row.priorityGroup ? "is-selected" : "",
                      )}
                      data-port-priority-choice={priorityGroup}
                      key={priorityGroup}
                      onClick={() => {
                        selectPriorityGroup(row.portKey, priorityGroup);
                      }}
                      type="button"
                    >
                      {priorityGroup}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </InspectorCollapsiblePanel>
  );
}
