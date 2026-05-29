import type { AppHost } from "@/app/host/app-host";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

export const BEHAVIOR_TOGGLE_INSPECTOR_KEY = "behavior-toggle";

export interface BehaviorToggleInspectorProps {
  appHost: AppHost;
  entity: WorldEntity;
  definition: EntityDefinition;
  translate: (key: string) => string;
}

export function BehaviorToggleInspector({
  appHost,
  entity,
}: BehaviorToggleInspectorProps) {
  const warehouseSubmitEnabled: boolean = (entity.config?.warehouseSubmitEnabled as boolean) ?? true;

  const handleToggle = () => {
    const editor = appHost.workspace.editor;
    if (editor === null) return;

    editor.actions.patchEntityConfig(entity.id, {
      warehouseSubmitEnabled: !warehouseSubmitEnabled,
    });
  };

  return (
    <article
      className={cm(styles, "definition-card")}
      data-inspector-key={BEHAVIOR_TOGGLE_INSPECTOR_KEY}
    >
      <label className={cm(styles, "behavior-toggle-row")}>
        <span className={cm(styles, "behavior-toggle-label")}>
          无线提交
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={warehouseSubmitEnabled}
          className={cm(styles, warehouseSubmitEnabled ? "toggle-on" : "toggle-off")}
          data-toggle-key="warehouse-submit-enabled"
          onClick={handleToggle}
        >
          {warehouseSubmitEnabled ? "ON" : "OFF"}
        </button>
      </label>
    </article>
  );
}
