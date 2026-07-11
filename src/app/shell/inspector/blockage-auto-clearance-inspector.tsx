import type { AppHost } from "@/app/host/app-host";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { InspectorCollapsiblePanel } from "@/app/shell/inspector/inspector-collapsible-panel";
import { useInspectorRenderMode } from "@/app/shell/inspector/selection-inspector-model";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

export function BlockageAutoClearanceInspector({
  appHost,
  definition,
  entity,
}: {
  appHost: AppHost;
  definition: EntityDefinition;
  entity: WorldEntity;
}) {
  const renderMode = useInspectorRenderMode();
  const deviceClass = appHost.state?.screenProfile?.deviceClass ?? "desktop";
  const declaration = definition.blockageAutoClearance;
  if (declaration === undefined) {
    return null;
  }

  const configuredEnabled = entity.config[declaration.enabledConfigKey];
  const enabled = typeof configuredEnabled === "boolean"
    ? configuredEnabled
    : declaration.enabledByDefault;
  const patchEntityConfig = (patch: Record<string, unknown>) => {
    appHost.workspace.editor?.actions.patchEntityConfig(entity.id, patch);
  };

  return (
    <InspectorCollapsiblePanel
      className="blockage-auto-clearance-inspector"
      dataInspectorKey="blockage-auto-clearance"
      title="自动处理复数配方阻塞"
    >
      <div
        className={cm(styles, "blockage-auto-clearance-panel-body")}
        data-device-class={deviceClass}
        data-render-mode={renderMode}
      >
        <label className={cm(styles, "blockage-auto-clearance-switch")}>
          <span>启用</span>
          <input
            aria-label="自动处理复数配方阻塞"
            checked={enabled}
            data-blockage-auto-clearance-switch
            onChange={(event) => {
              patchEntityConfig({
                [declaration.enabledConfigKey]: event.currentTarget.checked,
              });
            }}
            role="switch"
            type="checkbox"
          />
        </label>
      </div>
    </InspectorCollapsiblePanel>
  );
}
