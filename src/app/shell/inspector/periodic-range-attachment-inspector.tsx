import { useEffect, useState } from "react";

import type { AppHost } from "@/app/host/app-host";
import type { SceneAttachmentReference } from "@/domain/document/scene-view-input";
import {
  isPeriodicRangeRegionLayoutLegal,
  resolvePeriodicRangeLayoutAggregate,
  type PeriodicRangeEffect,
} from "@/shared/periodic-range-conversion";
import { resolvePeriodicRangeRegionByReference } from "@/app/canvas";
import { cm } from "@/app/shell/shared/css-module-class";
import styles from "./inspector.module.scss";

const ATTACHMENT_INSPECTOR_SAMPLE_MS = 50;

interface PeriodicRangeInspectorState {
  readonly invalid: boolean;
  readonly effect: PeriodicRangeEffect | null;
  readonly layers: number;
  readonly probability: number | null;
  readonly progressSeconds: number | null;
  readonly periodSeconds: number | null;
}

const INVALID_STATE: PeriodicRangeInspectorState = {
  invalid: true,
  effect: null,
  layers: 0,
  probability: null,
  progressSeconds: null,
  periodSeconds: null,
};

function formatPercent(probability: number | null): string {
  if (probability === null) return "—";
  const percent = probability * 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(1)}%`;
}

function formatSeconds(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * 附属实体只读面板。仿真未启动或目标区域不在运行态时使用布局预览；
 * 运行中按查看焦点读取单个区域，面板卸载即停止采样。
 */
export function PeriodicRangeAttachmentInspector({
  appHost,
  reference,
  translate,
}: {
  readonly appHost: AppHost;
  readonly reference: SceneAttachmentReference;
  readonly translate: (key: string) => string;
}) {
  const [state, setState] = useState<PeriodicRangeInspectorState | null>(null);

  useEffect(() => {
    const tick = () => {
      const editor = appHost.workspace.editor;
      if (editor === null) {
        appHost.internalActions.setAttachmentFocus(null);
        return;
      }
      const region = resolvePeriodicRangeRegionByReference({ appHost, editor, reference });
      if (region === null) {
        appHost.internalActions.setAttachmentFocus(null);
        return;
      }
      if (!isPeriodicRangeRegionLayoutLegal(region)) {
        setState((current) => current?.invalid === true ? current : INVALID_STATE);
        return;
      }
      const simulation = appHost.workspace.simulation;
      const running = simulation !== null && simulation.state.runningState !== "stop";
      const runtime = running ? simulation.queries.getPeriodicRegionRuntime(region.regionId) : null;
      if (runtime !== null) {
        setState({
          invalid: false,
          effect: runtime.effect,
          layers: runtime.layers,
          probability: runtime.probability,
          progressSeconds: runtime.progressSeconds,
          periodSeconds: runtime.periodSeconds,
        });
        return;
      }
      const layout = resolvePeriodicRangeLayoutAggregate(region);
      setState({
        invalid: false,
        effect: layout.effect,
        layers: layout.layers,
        probability: layout.probability,
        progressSeconds: null,
        periodSeconds: null,
      });
    };

    tick();
    const intervalId = window.setInterval(tick, ATTACHMENT_INSPECTOR_SAMPLE_MS);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [appHost, reference]);

  if (state === null) {
    return null;
  }

  return (
    <div className={cm(styles, "cluster")} data-selection-inspector-slot data-attachment-kind={reference.kind}>
      {state.invalid ? (
        <article className={cm(styles, "definition-card")}>
          <p>{translate("inspector.periodicRange.invalid")}</p>
        </article>
      ) : (
        <article className={cm(styles, "definition-card")}>
          <dl className={cm(styles, "kv-grid")}>
            <div className={cm(styles, "kv")}>
              <dt>{translate("inspector.periodicRange.effect")}</dt>
              <dd>{state.effect === null
                ? "—"
                : translate(`inspector.periodicRange.effect.${state.effect}`)}</dd>
            </div>
            <div className={cm(styles, "kv")}>
              <dt>{translate("inspector.periodicRange.layers")}</dt>
              <dd>{state.layers}</dd>
            </div>
            <div className={cm(styles, "kv")}>
              <dt>{translate("inspector.periodicRange.probability")}</dt>
              <dd>{formatPercent(state.probability)}</dd>
            </div>
            {state.progressSeconds !== null && state.periodSeconds !== null ? (
              <div className={cm(styles, "kv")}>
                <dt>{translate("inspector.periodicRange.progress")}</dt>
                <dd>{formatSeconds(state.progressSeconds)} / {formatSeconds(state.periodSeconds)}</dd>
              </div>
            ) : null}
          </dl>
        </article>
      )}
    </div>
  );
}
