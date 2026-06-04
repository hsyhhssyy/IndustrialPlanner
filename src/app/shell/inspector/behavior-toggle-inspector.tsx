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
          title="无线提交"
        >
          {/*
            AI-REMOVED 2026-06-04:
            Reason: switch 的视觉状态与 aria-checked 已表达开关状态，ON/OFF 文本重复表达。
            Trigger: 用户要求任何元素都不能重复传递同一信息。
            Evidence: InspectorPanel设计风格规范 2.5。
            Replacement: role="switch" + aria-checked + title
            Risk: Low
            Human Review: Required

            Original code:
            {warehouseSubmitEnabled ? "ON" : "OFF"}
          */}
        </button>
      </label>
    </article>
  );
}
