import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { observer } from "mobx-react-lite";
import LucideChevronLeft from "~icons/lucide/chevron-left";
import LucideFolder from "~icons/lucide/folder";

import {
  canSaveSelectionAsBlueprint,
  createSelectionBlueprintDocument,
  saveSelectionBlueprint,
} from "@/app/blueprint/save-blueprint";
import type { AppHost } from "@/app/host/app-host";
import { DialogShell } from "@/app/shell/shared/dialog-shell";
import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import type { BlueprintPreviewHandle, BlueprintPreviewViewport } from "@/domain/renderer";
import {
  createEmptyBlueprintLibraryDirectory,
  type BlueprintLibraryDirectoryListing,
  type BlueprintLibraryFolder,
} from "@/shared/blueprints/blueprint-library";
import {
  listBlueprintDirectory,
  readBlueprintFolder,
  saveBlueprintDocument,
} from "@/shared/storage/blueprint-storage";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

const DEFAULT_SAVE_BLUEPRINT_PREVIEW_VIEWPORT: BlueprintPreviewViewport = {
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
};

function shouldUseImmersiveMaximizedDialog(
  screenProfile: AppHost["state"]["screenProfile"],
): boolean {
  return screenProfile.deviceClass === "mobile" || screenProfile.deviceClass === "tablet";
}

function createDefaultBlueprintName(locale: AppHost["state"]["settings"]["locale"]): string {
  const date = new Date();
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const timestamp = `${year}${month}${day}${hours}${minutes}${seconds}`;

  return locale === "zh-CN"
    ? `未命名蓝图-${timestamp}`
    : `Untitled Blueprint-${timestamp}`;
}

function resolveBlueprintPreviewStageSize(element: HTMLDivElement) {
  const clientRect = element.getBoundingClientRect();

  return {
    width: Math.max(1, Math.floor(clientRect.width || element.clientWidth || 0)),
    height: Math.max(1, Math.floor(clientRect.height || element.clientHeight || 0)),
  };
}

function mountSaveBlueprintPreviewCanvas(
  host: HTMLDivElement,
  canvas: HTMLCanvasElement,
) {
  canvas.ariaHidden = "true";
  canvas.dataset.saveBlueprintPreviewCanvas = "true";
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  host.replaceChildren(canvas);
}

function formatBlueprintFolderPath(options: {
  readonly rootLabel: string;
  readonly folderStack: readonly BlueprintLibraryFolder[];
}): {
  readonly displayLabel: string;
  readonly fullLabel: string;
} {
  if (options.folderStack.length === 0) {
    return {
      displayLabel: options.rootLabel,
      fullLabel: options.rootLabel,
    };
  }

  const fullLabel = [options.rootLabel, ...options.folderStack.map((folder) => folder.name)].join(" / ");

  if (options.folderStack.length === 1) {
    return {
      displayLabel: fullLabel,
      fullLabel,
    };
  }

  const currentFolder = options.folderStack.at(-1);

  return {
    displayLabel: `${options.rootLabel} / … / ${currentFolder?.name ?? ""}`,
    fullLabel,
  };
}

async function resolveBlueprintFolderStack(
  parentFolderId: string | null,
): Promise<BlueprintLibraryFolder[]> {
  const folderStack: BlueprintLibraryFolder[] = [];
  const visitedFolderIds = new Set<string>();
  let currentFolderId = parentFolderId;

  while (currentFolderId !== null && !visitedFolderIds.has(currentFolderId)) {
    visitedFolderIds.add(currentFolderId);
    const folder = await readBlueprintFolder(currentFolderId);

    if (folder === null) {
      break;
    }

    folderStack.unshift(folder);
    currentFolderId = folder.parentFolderId;
  }

  return folderStack;
}

function createRenamedBlueprintDocument(options: {
  readonly document: BlueprintDocument;
  readonly name: string;
  readonly description: string;
}): BlueprintDocument {
  return {
    ...options.document,
    name: options.name.trim(),
    description: options.description.trim(),
    updatedAt: new Date().toISOString(),
  };
}

export const SaveBlueprintDialog = observer(function SaveBlueprintDialog({
  appHost,
}: {
  appHost: AppHost;
}) {
  const locale = appHost.state.settings.locale;
  const t = appHost.actions.translate;
  const controller = appHost.saveBlueprintDialog;
  const dialogState = controller.dialogState;
  const sourceDocument = controller.document;
  const renderHost = appHost.workspace.render;
  const isMobileCompactLayout = appHost.state.screenProfile.deviceClass === "mobile";
  const isPhoneLayout = appHost.state.screenProfile.deviceClass === "mobile";
  const isTabletLayout = appHost.state.screenProfile.deviceClass === "tablet";
  const canSaveSelection = canSaveSelectionAsBlueprint(appHost.workspace);
  const previewCanvasHostRef = useRef<HTMLDivElement | null>(null);
  const previewHandleRef = useRef<BlueprintPreviewHandle | null>(null);
  const folderInitializationRequestIdRef = useRef(0);
  const folderDirectoryRequestIdRef = useRef(0);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [folderErrorMessage, setFolderErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isFolderLoading, setIsFolderLoading] = useState(false);
  const [isFolderPickerReady, setIsFolderPickerReady] = useState(false);
  const [folderStack, setFolderStack] = useState<BlueprintLibraryFolder[]>([]);
  const [directoryListing, setDirectoryListing] = useState<BlueprintLibraryDirectoryListing>(
    createEmptyBlueprintLibraryDirectory(null),
  );
  const [selectionPreviewBlueprint, setSelectionPreviewBlueprint] = useState<BlueprintDocument | null>(null);
  const currentFolder = folderStack.length > 0 ? folderStack[folderStack.length - 1] ?? null : null;
  const currentFolderId = currentFolder?.folderId ?? null;
  const folderPath = formatBlueprintFolderPath({
    rootLabel: t("workbench.blueprint.rootFolder"),
    folderStack,
  });
  const previewBlueprint = controller.source === "selection"
    ? selectionPreviewBlueprint
    : sourceDocument;
  const canSaveSource = controller.source === "selection"
    ? canSaveSelection
    : sourceDocument !== null;
  const canSubmit = !isSaving
    && name.trim().length > 0
    && canSaveSource
    && isFolderPickerReady
    && !isFolderLoading
    && folderErrorMessage === null;

  useEffect(() => {
    if (!dialogState.visible) {
      setIsSaving(false);
      setErrorMessage(null);
      setFolderErrorMessage(null);
      setSelectionPreviewBlueprint(null);
      return;
    }

    if (controller.source === "selection") {
      const defaultName = createDefaultBlueprintName(locale);

      setName(defaultName);
      setDescription("");
      setSelectionPreviewBlueprint(createSelectionBlueprintDocument({
        workspace: appHost.workspace,
        name: defaultName,
        description: "",
      }));
    } else if (sourceDocument !== null) {
      setName(sourceDocument.name);
      setDescription(sourceDocument.description);
      setSelectionPreviewBlueprint(null);
    } else {
      setName(createDefaultBlueprintName(locale));
      setDescription("");
      setSelectionPreviewBlueprint(null);
    }

    setErrorMessage(null);
    setFolderErrorMessage(null);
    setIsSaving(false);
  }, [appHost.workspace, controller.source, dialogState.visible, locale, sourceDocument]);

  const copy = useMemo(() => (
    locale === "zh-CN"
      ? {
        titleCreate: "保存蓝图",
        titleImport: "保存导入蓝图",
        titleEdit: "修改蓝图",
        previewTitle: "蓝图预览",
        previewUnavailable: "当前没有可预览的蓝图。",
        nameLabel: "蓝图名称",
        namePlaceholder: "输入蓝图名称",
        descriptionLabel: "蓝图描述",
        descriptionPlaceholder: "可选，补充说明用途或布局特点",
        folderLabel: "保存位置",
        folderBack: "返回上一级",
        folderLoading: "正在读取目录...",
        folderEmpty: "当前目录下没有子文件夹。",
        folderLoadFailed: "读取蓝图文件夹失败，请检查浏览器存储是否可用。",
        cancel: "取消",
        save: "保存",
        saving: "保存中...",
        emptySelection: "当前至少需要选中一个实体才能保存蓝图。",
        requiredName: "请输入蓝图名称。",
        missingDocument: "当前蓝图不可用，请重新导入或打开蓝图。",
        saveFailed: "蓝图保存失败，请检查浏览器存储是否可用。",
      }
      : {
        titleCreate: "Save Blueprint",
        titleImport: "Save Imported Blueprint",
        titleEdit: "Edit Blueprint",
        previewTitle: "Blueprint Preview",
        previewUnavailable: "No blueprint is available to preview.",
        nameLabel: "Blueprint Name",
        namePlaceholder: "Enter a blueprint name",
        descriptionLabel: "Blueprint Description",
        descriptionPlaceholder: "Optional notes about purpose or layout",
        folderLabel: "Saved Folder",
        folderBack: "Up One Level",
        folderLoading: "Loading folders...",
        folderEmpty: "This folder has no subfolders.",
        folderLoadFailed: "Failed to load blueprint folders. Check browser storage availability.",
        cancel: "Cancel",
        save: "Save",
        saving: "Saving...",
        emptySelection: "Select at least one entity to save a blueprint.",
        requiredName: "Please enter a blueprint name.",
        missingDocument: "The blueprint is unavailable. Import or open it again.",
        saveFailed: "Failed to save blueprint. Check browser storage availability.",
      }
  ), [locale]);
  const dialogTitle = controller.source === "import"
    ? copy.titleImport
    : controller.source === "edit"
      ? copy.titleEdit
      : copy.titleCreate;

  useEffect(() => {
    if (!dialogState.visible) {
      setFolderStack([]);
      setDirectoryListing(createEmptyBlueprintLibraryDirectory(null));
      setIsFolderLoading(false);
      setIsFolderPickerReady(false);
      return;
    }

    let cancelled = false;
    const requestId = folderInitializationRequestIdRef.current + 1;
    folderInitializationRequestIdRef.current = requestId;

    setIsFolderLoading(true);
    setIsFolderPickerReady(false);
    setFolderErrorMessage(null);

    void resolveBlueprintFolderStack(controller.parentFolderId)
      .then((nextFolderStack) => {
        if (cancelled || folderInitializationRequestIdRef.current !== requestId) {
          return;
        }

        setFolderStack(nextFolderStack);
        setDirectoryListing(createEmptyBlueprintLibraryDirectory(nextFolderStack.at(-1)?.folderId ?? null));
        setIsFolderPickerReady(true);
      })
      .catch(() => {
        if (cancelled || folderInitializationRequestIdRef.current !== requestId) {
          return;
        }

        setFolderErrorMessage(copy.folderLoadFailed);
      })
      .finally(() => {
        if (cancelled || folderInitializationRequestIdRef.current !== requestId) {
          return;
        }

        setIsFolderLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [controller.parentFolderId, copy.folderLoadFailed, dialogState.visible]);

  useEffect(() => {
    if (!dialogState.visible || !isFolderPickerReady) {
      return;
    }

    let cancelled = false;
    const requestId = folderDirectoryRequestIdRef.current + 1;
    folderDirectoryRequestIdRef.current = requestId;

    setIsFolderLoading(true);
    setFolderErrorMessage(null);
    setDirectoryListing(createEmptyBlueprintLibraryDirectory(currentFolderId));

    void listBlueprintDirectory(currentFolderId)
      .then((listing) => {
        if (cancelled || folderDirectoryRequestIdRef.current !== requestId) {
          return;
        }

        setDirectoryListing(listing);
      })
      .catch(() => {
        if (cancelled || folderDirectoryRequestIdRef.current !== requestId) {
          return;
        }

        setFolderErrorMessage(copy.folderLoadFailed);
      })
      .finally(() => {
        if (cancelled || folderDirectoryRequestIdRef.current !== requestId) {
          return;
        }

        setIsFolderLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [copy.folderLoadFailed, currentFolderId, dialogState.visible, isFolderPickerReady]);

  useEffect(() => {
    const previewCanvasHost = previewCanvasHostRef.current;

    if (!dialogState.visible || previewBlueprint === null || renderHost === null || previewCanvasHost === null) {
      return;
    }

    let active = true;
    let mountedHandle: BlueprintPreviewHandle | null = null;
    const previewStageSize = resolveBlueprintPreviewStageSize(previewCanvasHost);

    void renderHost.actions.mountBlueprintPreview({
      blueprint: previewBlueprint,
      width: previewStageSize.width,
      height: previewStageSize.height,
      viewport: DEFAULT_SAVE_BLUEPRINT_PREVIEW_VIEWPORT,
    }).then((handle) => {
      if (!active) {
        renderHost.actions.disposeBlueprintPreview(handle);
        return;
      }

      mountedHandle = handle;
      previewHandleRef.current = handle;
      const canvas = renderHost.queries.getBlueprintPreviewCanvas(handle);

      if (canvas !== null) {
        mountSaveBlueprintPreviewCanvas(previewCanvasHost, canvas);
      }

      renderHost.actions.updateBlueprintPreviewViewport(handle, DEFAULT_SAVE_BLUEPRINT_PREVIEW_VIEWPORT);
    });

    return () => {
      active = false;
      previewHandleRef.current = null;
      previewCanvasHost.replaceChildren();

      if (mountedHandle !== null) {
        renderHost.actions.disposeBlueprintPreview(mountedHandle);
      }
    };
  }, [dialogState.visible, previewBlueprint, renderHost]);

  useEffect(() => {
    const previewCanvasHost = previewCanvasHostRef.current;

    if (
      !dialogState.visible
      || previewCanvasHost === null
      || renderHost === null
      || typeof ResizeObserver === "undefined"
    ) {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      if (previewHandleRef.current === null) {
        return;
      }

      const previewStageSize = resolveBlueprintPreviewStageSize(previewCanvasHost);

      renderHost.actions.resizeBlueprintPreview(
        previewHandleRef.current,
        previewStageSize.width,
        previewStageSize.height,
      );
    });

    resizeObserver.observe(previewCanvasHost);

    return () => {
      resizeObserver.disconnect();
    };
  }, [dialogState.visible, previewBlueprint, renderHost]);

  const handleClose = useCallback(() => {
    if (isSaving) {
      return;
    }

    controller.close();
  }, [controller, isSaving]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalizedName = name.trim();

    if (normalizedName.length === 0) {
      setErrorMessage(copy.requiredName);
      return;
    }

    if (controller.source === "selection" && !canSaveSelection) {
      setErrorMessage(copy.emptySelection);
      return;
    }

    if (controller.source !== "selection" && sourceDocument === null) {
      setErrorMessage(copy.missingDocument);
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    try {
      const saved = controller.source === "selection"
        ? await saveSelectionBlueprint({
          workspace: appHost.workspace,
          name: normalizedName,
          description,
          storageOptions: {
            parentFolderId: currentFolderId,
          },
        })
        : sourceDocument === null
          ? null
          : await saveBlueprintDocument(
            createRenamedBlueprintDocument({
              document: sourceDocument,
              name: normalizedName,
              description,
            }),
            {
              parentFolderId: currentFolderId,
            },
          );

      if (saved === null) {
        setErrorMessage(copy.saveFailed);
        return;
      }

      controller.markSaved();
      controller.close();
    } finally {
      setIsSaving(false);
    }
  };

  if (!dialogState.visible) {
    return null;
  }

  const initialShellStyle: CSSProperties | undefined = dialogState.width === null && dialogState.height === null
    ? {
      // TapTap 手机端按 Chrome 89 兼容；Chrome 89 不支持 inline style 中的 dvh/dvw，手机对话框使用 vh/vw。
      width: isPhoneLayout ? "100vw" : isTabletLayout ? "720px" : "760px",
      height: isPhoneLayout ? "100vh" : isTabletLayout ? "720px" : "680px",
      minHeight: isPhoneLayout ? "100vh" : "520px",
    }
    : undefined;

  return (
    <DialogShell
      bodyClassName="save-blueprint-dialog-body"
      className="save-blueprint-dialog"
      closeTitle={t("action.close")}
      compactMobileLayout={isMobileCompactLayout}
      dialogKey="save-blueprint"
      dialogState={dialogState}
      immersiveMaximized={dialogState.maximized && shouldUseImmersiveMaximizedDialog(appHost.state.screenProfile)}
      maximizeTitle={t("dialog.maximize")}
      onClose={handleClose}
      onOffsetChange={controller.setOffset}
      onResize={isPhoneLayout ? undefined : controller.setSize}
      onToggleMaximized={controller.toggleMaximized}
      restoreTitle={t("dialog.restore")}
      shellStyle={initialShellStyle}
      showMaximizeButton={!isPhoneLayout}
      title={dialogTitle}
      titleId="save-blueprint-dialog-title"
    >
      <div className={cm(styles, "save-blueprint-dialog-content")}>
        <div className={cm(styles, "save-blueprint-layout")}>
          <section className={cm(styles, "save-blueprint-preview-pane")} aria-label={copy.previewTitle}>
            <div className={cm(styles, "blueprint-preview-canvas-shell save-blueprint-preview-canvas-shell")}>
              {previewBlueprint === null || renderHost === null ? (
                <div className={cm(styles, "save-blueprint-preview-empty")}>{copy.previewUnavailable}</div>
              ) : (
                <div className={cm(styles, "blueprint-preview-canvas save-blueprint-preview-canvas")} ref={previewCanvasHostRef} />
              )}
            </div>
          </section>
          <form className={cm(styles, "save-blueprint-form")} onSubmit={(event) => {
            void handleSubmit(event);
          }}>
            <div className={cm(styles, "save-blueprint-form-content")}>
              <label className={cm(styles, "save-blueprint-field")}>
                <span className={cm(styles, "save-blueprint-label")}>{copy.nameLabel}</span>
                <input
                  autoFocus
                  className={cm(styles, "save-blueprint-input")}
                  disabled={isSaving}
                  maxLength={120}
                  onChange={(event) => {
                    setName(event.target.value);
                    if (errorMessage !== null) {
                      setErrorMessage(null);
                    }
                  }}
                  placeholder={copy.namePlaceholder}
                  type="text"
                  value={name}
                />
              </label>
              <label className={cm(styles, "save-blueprint-field save-blueprint-field-description")}>
                <span className={cm(styles, "save-blueprint-label")}>{copy.descriptionLabel}</span>
                <textarea
                  className={cm(styles, "save-blueprint-textarea")}
                  disabled={isSaving}
                  maxLength={500}
                  onChange={(event) => {
                    setDescription(event.target.value);
                  }}
                  placeholder={copy.descriptionPlaceholder}
                  rows={5}
                  value={description}
                />
              </label>
              <section className={cm(styles, "save-blueprint-field save-blueprint-folder-field")} aria-label={copy.folderLabel}>
                <span className={cm(styles, "save-blueprint-label")}>{copy.folderLabel}</span>
                <div className={cm(styles, "save-blueprint-folder-picker-card")}>
                  <div className={cm(styles, "blueprint-preview-folder-picker-toolbar save-blueprint-folder-picker-toolbar")}>
                    {currentFolder === null ? null : (
                      <button
                        aria-label={copy.folderBack}
                        className={cm(styles, "blueprint-utility-button blueprint-preview-folder-picker-back-button")}
                        data-ui-button-id="save-blueprint-folder-back-button"
                        disabled={isFolderLoading || isSaving}
                        onClick={() => {
                          setFolderErrorMessage(null);
                          setFolderStack((currentValue) => currentValue.slice(0, -1));
                        }}
                        type="button"
                      >
                        <LucideChevronLeft className={cm(styles, "button-icon-image")} />
                      </button>
                    )}
                    <span
                      className={cm(styles, "blueprint-preview-folder-picker-path")}
                      data-save-blueprint-folder-breadcrumb
                      title={folderPath.fullLabel}
                    >
                      {folderPath.displayLabel}
                    </span>
                  </div>
                  {folderErrorMessage === null ? null : (
                    <p className={cm(styles, "save-blueprint-error")} role="alert">{folderErrorMessage}</p>
                  )}
                  {isFolderLoading ? (
                    <p className={cm(styles, "blueprint-preview-footnote")}>{copy.folderLoading}</p>
                  ) : directoryListing.folders.length === 0 ? (
                    <p className={cm(styles, "blueprint-preview-footnote")}>{copy.folderEmpty}</p>
                  ) : (
                    <div className={cm(styles, "blueprint-preview-folder-picker-list save-blueprint-folder-picker-list")}>
                      {directoryListing.folders.map((folder) => (
                        <button
                          className={cm(styles, "save-blueprint-secondary-button blueprint-preview-folder-picker-entry")}
                          data-save-blueprint-folder-id={folder.folderId}
                          key={folder.folderId}
                          onClick={() => {
                            setFolderErrorMessage(null);
                            setFolderStack((currentValue) => [...currentValue, folder]);
                          }}
                          title={folder.name}
                          type="button"
                        >
                          <span aria-hidden="true" className={cm(styles, "button-icon blueprint-preview-folder-picker-entry-icon")}>
                            <LucideFolder className={cm(styles, "button-icon-image")} />
                          </span>
                          <span className={cm(styles, "blueprint-preview-folder-picker-entry-label")}>{folder.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </section>
              {errorMessage === null ? null : (
                <p className={cm(styles, "save-blueprint-error")} role="alert">{errorMessage}</p>
              )}
            </div>
            <div className={cm(styles, "save-blueprint-actions")}>
              <button
                className={cm(styles, "save-blueprint-secondary-button")}
                disabled={isSaving}
                onClick={handleClose}
                type="button"
              >
                {copy.cancel}
              </button>
              <button
                className={cm(styles, "save-blueprint-primary-button")}
                disabled={!canSubmit}
                type="submit"
              >
                {isSaving ? copy.saving : copy.save}
              </button>
            </div>
          </form>
        </div>
      </div>
    </DialogShell>
  );
});
