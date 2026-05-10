import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { observer } from "mobx-react-lite";

import type { AppHost } from "@/app/host/app-host";
import { useEditorDocumentSnapshot } from "@/app/shell/hooks/use-editor-document";
import { DialogShell } from "@/app/shell/shared/dialog-shell";
import type { EditorBaseDocumentSummary } from "@/domain/editor/editor-document";
import type { BaseDefinition } from "@/domain/registry/types/base-definition";

function shouldUseImmersiveMaximizedDialog(
  screenProfile: AppHost["state"]["screenProfile"],
): boolean {
  return screenProfile.deviceClass === "mobile" || screenProfile.deviceClass === "tablet";
}

export const BaseSelectDialog = observer(function BaseSelectDialog({
  appHost,
}: {
  appHost: AppHost;
}) {
  const t = appHost.actions.translate;
  const locale = appHost.state.settings.locale;
  const editor = appHost.workspace.editor;
  const currentDocument = useEditorDocumentSnapshot(editor);
  const dialogState = appHost.internalState.workbench.dialogState["base-select"];
  const isMobileCompactLayout = appHost.state.screenProfile.deviceClass === "mobile";
  const isPhoneLayout = appHost.state.screenProfile.deviceClass === "mobile";
  const isTabletLayout = appHost.state.screenProfile.deviceClass === "tablet";
  const [selectedBaseId, setSelectedBaseId] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<readonly EditorBaseDocumentSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const copy = useMemo(() => (
    locale === "zh-CN"
      ? {
        title: "选择基地",
        cancel: "取消",
        confirm: "确定",
        loading: "正在读取...",
        loadFailed: "读取基地失败。",
        entityUnit: "台设备",
        updatedAt: "上次编辑",
        noEdit: "未编辑",
      }
      : {
        title: "Select Base",
        cancel: "Cancel",
        confirm: "OK",
        loading: "Loading...",
        loadFailed: "Failed to load base.",
        entityUnit: "devices",
        updatedAt: "Updated",
        noEdit: "Never edited",
      }
  ), [locale]);

  useEffect(() => {
    if (!dialogState.visible) {
      setIsLoading(false);
      setIsSubmitting(false);
      setErrorMessage(null);
      return;
    }

    setSelectedBaseId(currentDocument?.baseId ?? appHost.workspace.registry.baseDefinitions[0]?.id ?? null);
    setErrorMessage(null);
  }, [appHost.workspace.registry.baseDefinitions, currentDocument?.baseId, dialogState.visible]);

  useEffect(() => {
    if (!dialogState.visible || editor === null) {
      return;
    }

    let disposed = false;
    setIsLoading(true);

    void editor.queries.listBaseDocumentSummaries()
      .then((nextSummaries) => {
        if (!disposed) {
          setSummaries(nextSummaries);
        }
      })
      .finally(() => {
        if (!disposed) {
          setIsLoading(false);
        }
      });

    return () => {
      disposed = true;
    };
  }, [currentDocument?.documentKey, dialogState.visible, editor]);

  const groupedBases = useMemo(
    () => groupBaseDefinitionsByTag(appHost.workspace.registry.baseDefinitions),
    [appHost.workspace.registry.baseDefinitions],
  );
  const summaryByBaseId = useMemo(
    () => new Map(summaries.map((summary) => [summary.baseId, summary])),
    [summaries],
  );

  const handleClose = useCallback(() => {
    if (isSubmitting) {
      return;
    }

    appHost.internalActions.closeDialog("base-select");
  }, [appHost, isSubmitting]);

  const handleConfirm = async () => {
    if (editor === null || selectedBaseId === null) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const didLoad = await editor.actions.loadLatestBaseDocument(selectedBaseId);

      if (!didLoad) {
        setErrorMessage(copy.loadFailed);
        return;
      }

      appHost.internalActions.closeDialog("base-select");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!dialogState.visible || editor === null) {
    return null;
  }

  const initialShellStyle: CSSProperties | undefined = dialogState.width === null && dialogState.height === null
    ? {
      width: isPhoneLayout ? "100%" : isTabletLayout ? "620px" : "560px",
      height: isPhoneLayout ? "min(620px, 100%)" : isTabletLayout ? "620px" : "560px",
      minHeight: isPhoneLayout ? "360px" : "420px",
    }
    : undefined;

  return (
    <DialogShell
      bodyClassName="base-select-dialog-body"
      className="base-select-dialog"
      closeTitle={t("action.close")}
      compactMobileLayout={isMobileCompactLayout}
      dialogKey="base-select"
      dialogState={dialogState}
      immersiveMaximized={dialogState.maximized && shouldUseImmersiveMaximizedDialog(appHost.state.screenProfile)}
      maximizeTitle={t("dialog.maximize")}
      onClose={handleClose}
      onOffsetChange={(offsetX, offsetY) => {
        appHost.internalActions.setDialogOffset("base-select", offsetX, offsetY);
      }}
      onResize={isPhoneLayout ? undefined : (width, height) => {
        appHost.internalActions.setDialogSize("base-select", width, height);
      }}
      onToggleMaximized={() => {
        appHost.internalActions.toggleDialogMaximized("base-select");
      }}
      restoreTitle={t("dialog.restore")}
      shellStyle={initialShellStyle}
      showMaximizeButton={!isPhoneLayout}
      title={copy.title}
      titleId="base-select-dialog-title"
    >
      <div className="base-select-dialog-content">
        <div className="base-select-group-list">
          {groupedBases.map((group) => (
            <section className="base-select-group" key={group.tag}>
              <h3>{group.tag}</h3>
              <div className="base-select-option-list">
                {group.bases.map((baseDefinition) => {
                  const summary = summaryByBaseId.get(baseDefinition.id);
                  const selected = selectedBaseId === baseDefinition.id;

                  return (
                    <button
                      aria-pressed={selected}
                      className={selected ? "base-select-option is-selected" : "base-select-option"}
                      data-base-id={baseDefinition.id}
                      disabled={isSubmitting}
                      key={baseDefinition.id}
                      onClick={() => {
                        setSelectedBaseId(baseDefinition.id);
                        setErrorMessage(null);
                      }}
                      type="button"
                    >
                      <span className="base-select-option-main">
                        <span className="base-select-option-name">{baseDefinition.name}</span>
                        <span className="base-select-option-meta">
                          {formatBaseSummary(copy, locale, summary)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
        <div className="base-select-actions">
          <div className="base-select-status" role={errorMessage === null ? undefined : "alert"}>
            {errorMessage ?? (isLoading ? copy.loading : "")}
          </div>
          <button
            className="save-blueprint-secondary-button"
            disabled={isSubmitting}
            onClick={handleClose}
            type="button"
          >
            {copy.cancel}
          </button>
          <button
            className="save-blueprint-primary-button"
            disabled={isSubmitting || selectedBaseId === null}
            onClick={() => {
              void handleConfirm();
            }}
            type="button"
          >
            {copy.confirm}
          </button>
        </div>
      </div>
    </DialogShell>
  );
});

function groupBaseDefinitionsByTag(
  baseDefinitions: readonly BaseDefinition[],
): Array<{ tag: string; bases: BaseDefinition[] }> {
  const groups: Array<{ tag: string; bases: BaseDefinition[] }> = [];
  const groupByTag = new Map<string, BaseDefinition[]>();

  for (const baseDefinition of baseDefinitions) {
    let group = groupByTag.get(baseDefinition.tag);

    if (group === undefined) {
      group = [];
      groupByTag.set(baseDefinition.tag, group);
      groups.push({ tag: baseDefinition.tag, bases: group });
    }

    group.push(baseDefinition);
  }

  return groups;
}

function formatBaseSummary(
  copy: {
    entityUnit: string;
    updatedAt: string;
    noEdit: string;
  },
  locale: AppHost["state"]["settings"]["locale"],
  summary: EditorBaseDocumentSummary | undefined,
): string {
  const entityCount = summary?.entityCount ?? 0;
  const entitySummary = `${entityCount} ${copy.entityUnit}`;
  const updatedAt = formatTimestamp(locale, summary?.updatedAt ?? null);

  return `${entitySummary} · ${copy.updatedAt} ${updatedAt ?? copy.noEdit}`;
}

function formatTimestamp(
  locale: AppHost["state"]["settings"]["locale"],
  value: string | null,
): string | null {
  if (value === null) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
