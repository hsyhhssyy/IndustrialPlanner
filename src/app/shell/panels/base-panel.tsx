import { useEffect, useState } from "react";

import { useEditorDocumentSnapshot } from "@/app/shell/hooks/use-editor-document";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import type { AppHost } from "@/app/host/app-host";
import { DEFAULT_WORLD_BASE_ID } from "@/domain/document/world-document";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

const BASE_PANEL_POWER_INTERVAL_MS = 250;

const POWER_ROWS = [
  {
    labelKey: "workbench.power.total",
    valueKey: "workbench.powerValue.total",
  },
  {
    labelKey: "workbench.power.covered",
    valueKey: "workbench.powerValue.covered",
  },
  {
    labelKey: "workbench.power.current",
    valueKey: "workbench.powerValue.current",
  },
  {
    labelKey: "workbench.power.mode",
    valueKey: "workbench.powerValue.mode",
  },
] as const;

export function BasePanel({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const editor = appHost.workspace.editor;
  const currentDocument = useEditorDocumentSnapshot(editor);
  const currentBaseId = currentDocument?.baseId ?? DEFAULT_WORLD_BASE_ID;
  const currentBase = appHost.workspace.registry.baseDefinitions.find(
    (definition) => definition.id === currentBaseId,
  ) ?? appHost.workspace.registry.baseDefinitions[0] ?? null;
  const currentBaseName = currentBase?.name ?? currentBaseId;

  // 主动轮询仿真文档级运行时数据（非 MobX 被动响应）
  const [totalPowerDemand, setTotalPowerDemand] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => {
      const docStatus = appHost.workspace.simulation?.queries.getDocumentRuntimeStatus() ?? null;
      setTotalPowerDemand(docStatus?.totalPowerDemand ?? null);
    };

    tick();
    const intervalId = window.setInterval(tick, BASE_PANEL_POWER_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [appHost]);

  const totalPowerValue = totalPowerDemand !== null ? `${totalPowerDemand} kW` : "0 kW";

  return (
    <div className={cm(styles, "stack")}>
      <article className={cm(styles, "inspector-card")}>
        <div className={cm(styles, "card-header")}>
          <h3>{t("rightDock.base")}</h3>
        </div>
        <button
          className={cm(styles, "base-current-button")}
          data-ui-button-id="base-current-select"
          disabled={editor === null}
          onClick={() => {
            appHost.internalActions.openDialog("base-select");
          }}
          type="button"
        >
          <span className={cm(styles, "base-current-button-label")}>{currentBaseName}</span>
          <span className={cm(styles, "base-current-button-icon")}>
            <WorkbenchIcon kind="edit" />
          </span>
        </button>
      </article>
      <article className={cm(styles, "inspector-card")}>
        <div className={cm(styles, "card-header")}>
          <h3>{t("rightDock.power")}</h3>
        </div>
        <dl className={cm(styles, "inspector-summary-list")}>
          {POWER_ROWS.map((entry, index) => {
            const isFirstRow = index === 0;
            const value = isFirstRow ? totalPowerValue : t(entry.valueKey);

            return (
              <div className={cm(styles, "inspector-summary-row")} key={`left-dock-power-summary-${index}`}>
                <dt>{t(entry.labelKey)}</dt>
                <dd>{value}</dd>
              </div>
            );
          })}
        </dl>
      </article>
    </div>
  );
}
