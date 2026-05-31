import { observer } from "mobx-react-lite";
import type { AppHost } from "@/app/host/app-host";
import { SelectionInspectorActionStrip } from "@/app/shell/inspector/selection-inspector-action-strip";
import type { SelectionInspectorPanelProps } from "@/app/shell/inspector/selection-inspector-model";
import { InspectorRenderModeContext } from "@/app/shell/inspector/selection-inspector-model";
import { SelectionInspectorSlot } from "@/app/shell/inspector/selection-inspector-slot";
import {
  NoSelectionState,
} from "@/app/shell/inspector/selection-inspector-shared";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

export const EditSelectionInspector = observer(function EditSelectionInspector({
  appHost,
  state,
  context: _context,
  mode,
  translate,
}: SelectionInspectorPanelProps & {
  appHost: AppHost;
  translate: (key: string) => string;
}) {
  const locale = state.locale;
  const selectionCount = appHost.workspace.editor?.state.collections.selection.length ?? 0;

  if (selectionCount === 0) {
    return (
      <InspectorRenderModeContext.Provider value={mode}>
        <NoSelectionState locale={locale} translate={translate} />
      </InspectorRenderModeContext.Provider>
    );
  }

  if (selectionCount > 1) {
    return (
      <InspectorRenderModeContext.Provider value={mode}>
        <div className={cm(styles, "cluster")}>
          <SelectionInspectorActionStrip appHost={appHost} />
          <article className={cm(styles, "definition-card")}>
            <p>{translate("label.multiSelectionSummary")}</p>
          </article>
        </div>
      </InspectorRenderModeContext.Provider>
    );
  }

  return (
    <InspectorRenderModeContext.Provider value={mode}>
      <div className={cm(styles, "cluster")}>
        {/*
          AI-REMOVED 2026-05-31:
          Reason: 单选 inspector 的操作按钮移动到设备信息顶部栏，与新版 inspector dialog 设计保持一致。
          Trigger: 用户要求按设计稿调整“顶部设备信息与按钮区域”的 UI。
          Evidence: 设计稿中设备名/ID 与“移动/删除”等操作位于同一顶部区域。
          Replacement: SelectionInspectorSlot 内的 selection-inspector-device-header。
          Risk: Low
          Human Review: Required

          Original code:
          <SelectionInspectorActionStrip appHost={appHost} />
        */}
        <SelectionInspectorSlot appHost={appHost} translate={translate} />
      </div>
    </InspectorRenderModeContext.Provider>
  );
});
