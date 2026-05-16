import { observer } from "mobx-react-lite";
import type { AppHost } from "@/app/host/app-host";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import type { EditorHistoryRecord } from "@/domain/editor/editor-history";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

export const HistoryPanel = observer(function HistoryPanel({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const editor = appHost.workspace.editor;
  const history = editor?.state.history;
  const records = history?.records.slice().reverse() ?? [];
  const cursorSequence = history?.cursorSequence ?? 0;
  const undoDepth = history?.undoDepth ?? 0;
  const redoDepth = history?.redoDepth ?? 0;
  const canUndo = editor !== null && undoDepth > 0;
  const canRedo = editor !== null && redoDepth > 0;
  // AI-REMOVED 2026-05-10:
  // Reason: 历史面板头部只保留撤销与重做，清空历史操作已从该入口下线。
  // Trigger: 用户要求删除“删除所有历史”按钮。
  // Evidence: 当前组件直接渲染该按钮，且本地状态只用于该按钮的禁用态。
  // Replacement: None
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // const canClear = editor !== null && records.length > 0;
  const isReady = history?.isReady ?? true;

  return (
    <div className={cm(styles, "history-panel stack")}>
      <section className={cm(styles, "placeholder-section history-actions-section")}>
        <div className={cm(styles, "placeholder-section-header")}>
          <h3>{t("workbench.section.historyActions")}</h3>
          {/*
            AI-REMOVED 2026-05-10:
            Reason: 历史面板头部不再显示操作区角标。
            Trigger: 用户要求删除该面板两个区域的角标。
            Evidence: 当前角标仅在此处渲染撤销/重做深度信息。
            Replacement: None
            Risk: Low
            Human Review: Required

            Original code:
            <span className="pill">{`${undoDepth}/${redoDepth}`}</span>
          */}
        </div>
        <div className={cm(styles, "history-action-grid")}>
          <button
            className={cm(styles, "history-action-button")}
            data-ui-button-id="history-action-undo"
            disabled={!canUndo}
            onClick={() => {
              editor?.actions.undoDocumentHistory();
            }}
            title={t("workbench.button.undo")}
            type="button"
          >
            <span aria-hidden="true" className={cm(styles, "button-icon")}>
              <WorkbenchIcon className={cm(styles, "button-icon-image")} kind="undo" />
            </span>
            <span className={cm(styles, "history-action-label")}>{t("workbench.button.undo")}</span>
          </button>
          <button
            className={cm(styles, "history-action-button")}
            data-ui-button-id="history-action-redo"
            disabled={!canRedo}
            onClick={() => {
              editor?.actions.redoDocumentHistory();
            }}
            title={t("workbench.button.redo")}
            type="button"
          >
            <span aria-hidden="true" className={cm(styles, "button-icon")}>
              <WorkbenchIcon className={cm(styles, "button-icon-image")} kind="redo" />
            </span>
            <span className={cm(styles, "history-action-label")}>{t("workbench.button.redo")}</span>
          </button>
          {/*
            AI-REMOVED 2026-05-10:
            Reason: 历史面板顶部操作区只保留撤销与重做，清空历史按钮已移除。
            Trigger: 用户要求删除“删除所有历史”操作。
            Evidence: 该按钮仅在此处渲染，且需求明确要求去掉。
            Replacement: None
            Risk: Low
            Human Review: Required

            Original code:
            <button
              data-ui-button-id="history-action-clear"
              disabled={!canClear}
              onClick={() => {
                editor?.actions.clearDocumentHistory();
              }}
              type="button"
            >
              {t("workbench.button.clearHistory")}
            </button>
          */}
        </div>
      </section>

      <section className={cm(styles, "placeholder-section history-lane-section")}>
        <div className={cm(styles, "placeholder-section-header")}>
          <h3>{t("workbench.section.historyLane")}</h3>
          {/*
            AI-REMOVED 2026-05-10:
            Reason: 历史面板头部不再显示历史列表区角标。
            Trigger: 用户要求删除该面板两个区域的角标。
            Evidence: 当前角标仅在此处渲染历史记录数量/加载状态。
            Replacement: None
            Risk: Low
            Human Review: Required

            Original code:
            <span className="pill">{isReady ? records.length : t("workbench.history.loading")}</span>
          */}
        </div>
        {isReady && records.length === 0 ? (
          <div className={cm(styles, "history-empty-state")}>
            <h3>{t("workbench.history.emptyTitle")}</h3>
          </div>
        ) : (
          <div className={cm(styles, "history-record-list")}>
            {records.map((record) => (
              <HistoryRecordButton
                currentSequence={cursorSequence}
                key={record.id}
                onRestore={() => {
                  editor?.actions.restoreDocumentHistoryTo(record.sequence);
                }}
                record={record}
                translate={t}
              />
            ))}
            {records.length > 0 ? (
              <button
                className={cm(styles, cursorSequence === 0
                  ? "history-record-button is-current"
                  : "history-record-button")}
                data-history-record-sequence="0"
                disabled={editor === null || cursorSequence === 0}
                onClick={() => {
                  editor?.actions.restoreDocumentHistoryTo(0);
                }}
                type="button"
              >
                <span className={cm(styles, "history-record-main")}>
                  <span className={cm(styles, "history-record-sequence")}>#0</span>
                  <span className={cm(styles, "history-record-title")}>{t("workbench.history.initialState")}</span>
                </span>
                {/*
                  AI-REMOVED 2026-05-10:
                  Reason: 历史条目卡片只显示序号和标题，其余信息不再展示。
                  Trigger: 用户要求删除历史记录条目中的额外信息，并强制单行显示。
                  Evidence: 初始状态条目原先额外渲染了状态文本。
                  Replacement: None
                  Risk: Low
                  Human Review: Required

                  Original code:
                  <span className="history-record-main">
                    <span className="history-record-title">{t("workbench.history.initialState")}</span>
                    <span className="history-record-status">
                      {cursorSequence === 0
                        ? t("workbench.history.current")
                        : t("workbench.history.applied")}
                    </span>
                  </span>
                */}
              </button>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
});

function HistoryRecordButton({
  currentSequence,
  onRestore,
  record,
  translate: _translate,
}: {
  currentSequence: number;
  onRestore: () => void;
  record: EditorHistoryRecord;
  translate: (key: string) => string;
}) {
  const isCurrent = record.sequence === currentSequence;
  const _isRedoable = record.sequence > currentSequence;
  const _detail = resolveRecordDetail(record);

  return (
    <button
      className={cm(styles, isCurrent
        ? "history-record-button is-current"
        : "history-record-button")}
      data-history-record-sequence={record.sequence}
      disabled={isCurrent}
      onClick={onRestore}
      type="button"
    >
      <span className={cm(styles, "history-record-main")}>
        <span className={cm(styles, "history-record-sequence")}>{`#${record.sequence}`}</span>
        <span className={cm(styles, "history-record-title")}>{record.action.label}</span>
      </span>
      {/*
        AI-REMOVED 2026-05-10:
        Reason: 历史条目卡片只显示序号和标题，其余状态、时间和详情信息不再展示。
        Trigger: 用户要求删除历史记录条目中的额外信息，并强制单行显示。
        Evidence: 当前按钮额外渲染了状态、时间与 detail 文本，直接造成信息冗余和多行布局。
        Replacement: None
        Risk: Low
        Human Review: Required

        Original code:
        <span className="history-record-main">
          <span className="history-record-title">{record.action.label}</span>
          <span className="history-record-status">
            {isCurrent
              ? translate("workbench.history.current")
              : isRedoable
                ? translate("workbench.history.redoable")
                : translate("workbench.history.applied")}
          </span>
        </span>
        <span className="history-record-meta">
          <span>{`#${record.sequence}`}</span>
          <span>{formatHistoryTime(record.createdAt)}</span>
        </span>
        {detail === "" ? null : (
          <span className="history-record-detail">{detail}</span>
        )}
      */}
    </button>
  );
}

function resolveRecordDetail(record: EditorHistoryRecord): string {
  const detailParts = [
    record.action.detail,
    record.action.count === undefined ? null : `${record.action.count}`,
  ].filter((part): part is string => typeof part === "string" && part !== "");

  return detailParts.join(" · ");
}

function _formatHistoryTime(createdAt: string): string {
  const date = new Date(createdAt);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
