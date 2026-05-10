import { observer } from "mobx-react-lite";
import type { AppHost } from "@/app/host/app-host";
import type { EditorHistoryRecord } from "@/domain/editor/editor-history";

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
  const canClear = editor !== null && records.length > 0;
  const isReady = history?.isReady ?? true;

  return (
    <div className="history-panel stack">
      <section className="placeholder-section history-actions-section">
        <div className="placeholder-section-header">
          <h3>{t("workbench.section.historyActions")}</h3>
          <span className="pill">{`${undoDepth}/${redoDepth}`}</span>
        </div>
        <div className="history-action-grid">
          <button
            data-ui-button-id="history-action-undo"
            disabled={!canUndo}
            onClick={() => {
              editor?.actions.undoDocumentHistory();
            }}
            type="button"
          >
            {t("workbench.button.undo")}
          </button>
          <button
            data-ui-button-id="history-action-redo"
            disabled={!canRedo}
            onClick={() => {
              editor?.actions.redoDocumentHistory();
            }}
            type="button"
          >
            {t("workbench.button.redo")}
          </button>
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
        </div>
      </section>

      <section className="placeholder-section history-lane-section">
        <div className="placeholder-section-header">
          <h3>{t("workbench.section.historyLane")}</h3>
          <span className="pill">{isReady ? records.length : t("workbench.history.loading")}</span>
        </div>
        {isReady && records.length === 0 ? (
          <div className="history-empty-state">
            <h3>{t("workbench.history.emptyTitle")}</h3>
          </div>
        ) : (
          <div className="history-record-list">
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
                className={cursorSequence === 0
                  ? "history-record-button is-current"
                  : "history-record-button"}
                data-history-record-sequence="0"
                disabled={editor === null || cursorSequence === 0}
                onClick={() => {
                  editor?.actions.restoreDocumentHistoryTo(0);
                }}
                type="button"
              >
                <span className="history-record-main">
                  <span className="history-record-title">{t("workbench.history.initialState")}</span>
                  <span className="history-record-status">
                    {cursorSequence === 0
                      ? t("workbench.history.current")
                      : t("workbench.history.applied")}
                  </span>
                </span>
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
  translate,
}: {
  currentSequence: number;
  onRestore: () => void;
  record: EditorHistoryRecord;
  translate: (key: string) => string;
}) {
  const isCurrent = record.sequence === currentSequence;
  const isRedoable = record.sequence > currentSequence;
  const detail = resolveRecordDetail(record);

  return (
    <button
      className={isCurrent
        ? "history-record-button is-current"
        : "history-record-button"}
      data-history-record-sequence={record.sequence}
      disabled={isCurrent}
      onClick={onRestore}
      type="button"
    >
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

function formatHistoryTime(createdAt: string): string {
  const date = new Date(createdAt);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
