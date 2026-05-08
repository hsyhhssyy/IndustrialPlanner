import { observer } from "mobx-react-lite";
import { useEffect, useRef, useState } from "react";
import type { AppHost } from "@/app/host/app-host";
import { isMobileOrTabletScreenProfile } from "@/shared/browser/screen-profile";
import {
  createBlueprintFolder,
  listBlueprintDirectory,
  type BlueprintDirectoryListing,
  type BlueprintFolderRecord,
  type BlueprintRecord,
} from "@/shared/storage/blueprint-storage";
import LucideChevronLeft from "~icons/lucide/chevron-left";
import LucideClipboard from "~icons/lucide/clipboard";
import LucideCopy from "~icons/lucide/copy";
import LucideDownload from "~icons/lucide/download";
import LucideFileText from "~icons/lucide/file-text";
import LucideFolder from "~icons/lucide/folder";
import LucideFolderOpen from "~icons/lucide/folder-open";
import LucideFolderPlus from "~icons/lucide/folder-plus";
import LucideUpload from "~icons/lucide/upload";

type BlueprintLibraryTab = "system" | "user";

interface BlueprintPanelCopy {
  readonly importFromFile: string;
  readonly importFromClipboard: string;
  readonly exportToFile: string;
  readonly copyToClipboard: string;
  readonly operationsPending: string;
  readonly systemTab: string;
  readonly userTab: string;
  readonly rootFolder: string;
  readonly createFolder: string;
  readonly createFolderPlaceholder: string;
  readonly createFolderSubmit: string;
  readonly cancel: string;
  readonly folderNameRequired: string;
  readonly folderCreateFailed: string;
  readonly loading: string;
  readonly emptyDirectoryTitle: string;
  readonly emptyDirectoryDescription: string;
  readonly folderBadge: string;
  readonly blueprintBadge: string;
  readonly foldersLabel: (count: number) => string;
  readonly blueprintsLabel: (count: number) => string;
  readonly systemEmptyTitle: string;
  readonly systemEmptyDescription: string;
  readonly detailsTitle: string;
  readonly noDescription: string;
  readonly detailsVersion: string;
  readonly detailsBase: string;
  readonly detailsEntities: string;
  readonly detailsLinks: string;
  readonly detailsUpdatedAt: string;
  readonly previewPending: string;
}

interface BlueprintOperationButtonDefinition {
  readonly uiButtonId: string;
  readonly label: string;
  readonly Icon: typeof LucideUpload;
}

function getBlueprintPanelCopy(locale: AppHost["state"]["settings"]["locale"]): BlueprintPanelCopy {
  if (locale === "zh-CN") {
    return {
      importFromFile: "从文件导入",
      importFromClipboard: "从剪贴板导入",
      exportToFile: "导出到文件",
      copyToClipboard: "复制到剪贴板",
      operationsPending: "蓝图浏览和文件夹管理已接通；导入、导出与剪贴板操作将在后续子需求中接入。",
      systemTab: "系统蓝图",
      userTab: "用户蓝图",
      rootFolder: "根目录",
      createFolder: "新建文件夹",
      createFolderPlaceholder: "输入文件夹名称",
      createFolderSubmit: "创建",
      cancel: "取消",
      folderNameRequired: "请输入文件夹名称。",
      folderCreateFailed: "创建文件夹失败，请检查浏览器存储是否可用。",
      loading: "正在读取蓝图库...",
      emptyDirectoryTitle: "当前目录为空",
      emptyDirectoryDescription: "这里还没有蓝图或文件夹。你可以先保存蓝图，或在当前目录下创建子文件夹。",
      folderBadge: "文件夹",
      blueprintBadge: "蓝图",
      foldersLabel: (count) => `${count} 个文件夹`,
      blueprintsLabel: (count) => `${count} 个蓝图`,
      systemEmptyTitle: "系统蓝图尚未接入",
      systemEmptyDescription: "预设蓝图会在 public/blueprints 接入后显示在这里。",
      detailsTitle: "蓝图详情",
      noDescription: "暂无描述",
      detailsVersion: "版本",
      detailsBase: "地图",
      detailsEntities: "实体数",
      detailsLinks: "连线数",
      detailsUpdatedAt: "更新时间",
      previewPending: "预览对话框将在 R5 接入；当前先提供目录浏览与元数据查看。",
    };
  }

  return {
    importFromFile: "Import from File",
    importFromClipboard: "Import from Clipboard",
    exportToFile: "Export to File",
    copyToClipboard: "Copy to Clipboard",
    operationsPending: "Browsing and folder management are available; import, export, and clipboard actions will land in later blueprint subtasks.",
    systemTab: "System Blueprints",
    userTab: "User Blueprints",
    rootFolder: "Root",
    createFolder: "New Folder",
    createFolderPlaceholder: "Enter folder name",
    createFolderSubmit: "Create",
    cancel: "Cancel",
    folderNameRequired: "Please enter a folder name.",
    folderCreateFailed: "Failed to create folder. Check browser storage availability.",
    loading: "Loading blueprint library...",
    emptyDirectoryTitle: "This directory is empty",
    emptyDirectoryDescription: "There are no blueprints or folders here yet. Save a blueprint first, or create a subfolder in this directory.",
    folderBadge: "Folder",
    blueprintBadge: "Blueprint",
    foldersLabel: (count) => `${count} folders`,
    blueprintsLabel: (count) => `${count} blueprints`,
    systemEmptyTitle: "System blueprints are not connected yet",
    systemEmptyDescription: "Preset blueprints will appear here once public/blueprints is wired in.",
    detailsTitle: "Blueprint Details",
    noDescription: "No description",
    detailsVersion: "Version",
    detailsBase: "Base",
    detailsEntities: "Entities",
    detailsLinks: "Links",
    detailsUpdatedAt: "Updated",
    previewPending: "The preview dialog will land with R5; for now this panel focuses on browsing and metadata.",
  };
}

function createEmptyDirectoryListing(parentFolderId: string | null): BlueprintDirectoryListing {
  return {
    parentFolderId,
    folders: [],
    blueprints: [],
  };
}

function formatBlueprintTimestamp(locale: string, value: string): string {
  const timestamp = new Date(value);

  if (Number.isNaN(timestamp.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

export const BlueprintPanel = observer(function BlueprintPanel({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const copy = getBlueprintPanelCopy(appHost.state.settings.locale);
  const isTouchLayout = isMobileOrTabletScreenProfile(appHost.state.screenProfile);
  const isPanelVisible = (appHost.internalState.runtime.activePanel ?? "placement") === "blueprint";
  const dialogVisible = appHost.internalState.workbench.dialogState["save-blueprint"].visible;
  const [activeTab, setActiveTab] = useState<BlueprintLibraryTab>("user");
  const [folderStack, setFolderStack] = useState<BlueprintFolderRecord[]>([]);
  const [directoryListing, setDirectoryListing] = useState<BlueprintDirectoryListing>(
    createEmptyDirectoryListing(null),
  );
  const [isLoading, setIsLoading] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [createFolderName, setCreateFolderName] = useState("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedBlueprintId, setSelectedBlueprintId] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const currentFolder = folderStack.length > 0 ? folderStack[folderStack.length - 1] : null;
  const currentFolderId = currentFolder?.folderId ?? null;
  const selectedBlueprint = directoryListing.blueprints.find(
    (record) => record.blueprintId === selectedBlueprintId,
  ) ?? null;

  useEffect(() => {
    if (activeTab !== "user" || !isPanelVisible) {
      return;
    }

    let cancelled = false;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setIsLoading(true);
    setErrorMessage(null);
    setDirectoryListing(createEmptyDirectoryListing(currentFolderId));

    void listBlueprintDirectory(currentFolderId)
      .then((listing) => {
        if (cancelled || requestIdRef.current !== requestId) {
          return;
        }

        setDirectoryListing(listing);
        setSelectedBlueprintId((currentBlueprintId) => {
          if (currentBlueprintId === null) {
            return null;
          }

          return listing.blueprints.some((record) => record.blueprintId === currentBlueprintId)
            ? currentBlueprintId
            : null;
        });
      })
      .finally(() => {
        if (cancelled || requestIdRef.current !== requestId) {
          return;
        }

        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, currentFolderId, dialogVisible, isPanelVisible, reloadVersion]);

  useEffect(() => {
    setCreateFolderOpen(false);
    setCreateFolderName("");
    setErrorMessage(null);
    setSelectedBlueprintId(null);
  }, [activeTab, currentFolderId]);

  const operationButtons: readonly BlueprintOperationButtonDefinition[] = [
    {
      uiButtonId: "blueprint-action-import-file",
      label: copy.importFromFile,
      Icon: LucideUpload,
    },
    {
      uiButtonId: "blueprint-action-import-clipboard",
      label: copy.importFromClipboard,
      Icon: LucideClipboard,
    },
    {
      uiButtonId: "blueprint-action-export-file",
      label: copy.exportToFile,
      Icon: LucideDownload,
    },
    {
      uiButtonId: "blueprint-action-copy-clipboard",
      label: copy.copyToClipboard,
      Icon: LucideCopy,
    },
  ];

  const handleCreateFolder = async () => {
    if (isCreatingFolder) {
      return;
    }

    const normalizedName = createFolderName.trim();

    if (normalizedName.length === 0) {
      setErrorMessage(copy.folderNameRequired);
      return;
    }

    setIsCreatingFolder(true);
    setErrorMessage(null);

    const createdFolder = await createBlueprintFolder({
      name: normalizedName,
      parentFolderId: currentFolderId,
    });

    setIsCreatingFolder(false);

    if (createdFolder === null) {
      setErrorMessage(copy.folderCreateFailed);
      return;
    }

    setCreateFolderOpen(false);
    setCreateFolderName("");
    setReloadVersion((currentValue) => currentValue + 1);
  };

  const renderOperationButton = (button: BlueprintOperationButtonDefinition) => {
    return (
      <button
        aria-label={button.label}
        className="placement-button placement-action-button blueprint-action-button"
        data-ui-button-id={button.uiButtonId}
        disabled
        key={button.uiButtonId}
        title={button.label}
        type="button"
      >
        <span aria-hidden="true" className="button-icon">
          <button.Icon className="button-icon-image" />
        </span>
        {isTouchLayout ? null : <span className="placement-button-label">{button.label}</span>}
      </button>
    );
  };

  const renderUserBlueprintDirectory = () => {
    return (
      <div className="blueprint-library-pane" role="tabpanel">
        <div className="blueprint-browser-toolbar">
          <div className="blueprint-breadcrumb">
            {currentFolder === null ? null : (
              <button
                aria-label={copy.rootFolder}
                className="blueprint-utility-button blueprint-back-button"
                data-ui-button-id="blueprint-folder-back"
                onClick={() => {
                  setFolderStack((currentValue) => currentValue.slice(0, -1));
                }}
                type="button"
              >
                <LucideChevronLeft className="button-icon-image" />
              </button>
            )}
            <span className="pill">{copy.userTab}</span>
            <span className="blueprint-path-label">
              {currentFolder === null
                ? copy.rootFolder
                : folderStack.map((folder) => folder.name).join(" / ")}
            </span>
          </div>
          <button
            className="blueprint-utility-button"
            data-ui-button-id="blueprint-folder-create-toggle"
            onClick={() => {
              setCreateFolderOpen((currentValue) => !currentValue);
              setErrorMessage(null);
            }}
            type="button"
          >
            <LucideFolderPlus className="button-icon-image" />
            <span>{copy.createFolder}</span>
          </button>
        </div>

        <div className="blueprint-library-status" aria-live="polite">
          <span className="pill">{copy.foldersLabel(directoryListing.folders.length)}</span>
          <span className="pill">{copy.blueprintsLabel(directoryListing.blueprints.length)}</span>
        </div>

        {createFolderOpen ? (
          <form
            className="blueprint-folder-form"
            onSubmit={(event) => {
              event.preventDefault();
              void handleCreateFolder();
            }}
          >
            <input
              className="blueprint-folder-input"
              data-blueprint-folder-input
              onChange={(event) => {
                setCreateFolderName(event.currentTarget.value);
                if (errorMessage !== null) {
                  setErrorMessage(null);
                }
              }}
              placeholder={copy.createFolderPlaceholder}
              type="text"
              value={createFolderName}
            />
            <button
              className="blueprint-utility-button"
              data-ui-button-id="blueprint-folder-create-submit"
              disabled={isCreatingFolder}
              type="submit"
            >
              {copy.createFolderSubmit}
            </button>
            <button
              className="blueprint-utility-button is-secondary"
              data-ui-button-id="blueprint-folder-create-cancel"
              onClick={() => {
                setCreateFolderOpen(false);
                setCreateFolderName("");
                setErrorMessage(null);
              }}
              type="button"
            >
              {copy.cancel}
            </button>
          </form>
        ) : null}

        {errorMessage === null ? null : (
          <p className="blueprint-panel-error" role="alert">{errorMessage}</p>
        )}

        {isLoading ? <p className="blueprint-panel-note">{copy.loading}</p> : null}

        {directoryListing.folders.length === 0 && directoryListing.blueprints.length === 0 && !isLoading ? (
          <section className="placeholder-section blueprint-empty-state">
            <div className="placeholder-section-header">
              <h3>{copy.emptyDirectoryTitle}</h3>
              <span className="pill">0</span>
            </div>
            <p>{copy.emptyDirectoryDescription}</p>
          </section>
        ) : null}

        {directoryListing.folders.length > 0 || directoryListing.blueprints.length > 0 ? (
          <div className="blueprint-browser-list">
            {directoryListing.folders.map((folder) => (
              <button
                className="blueprint-entry-button blueprint-folder-entry-button"
                data-blueprint-folder-id={folder.folderId}
                key={folder.folderId}
                onClick={() => {
                  setFolderStack((currentValue) => [...currentValue, folder]);
                }}
                type="button"
              >
                <span aria-hidden="true" className="button-icon blueprint-entry-icon">
                  <LucideFolder className="button-icon-image" />
                </span>
                <span className="blueprint-entry-copy">
                  <span className="blueprint-entry-title">{folder.name}</span>
                  <span className="blueprint-entry-meta">
                    {formatBlueprintTimestamp(appHost.state.settings.locale, folder.updatedAt)}
                  </span>
                </span>
                <span className="pill">{copy.folderBadge}</span>
              </button>
            ))}

            {directoryListing.blueprints.map((record) => {
              const isSelected = record.blueprintId === selectedBlueprintId;

              return (
                <button
                  aria-pressed={isSelected ? true : undefined}
                  className={isSelected
                    ? "blueprint-entry-button blueprint-blueprint-entry-button is-selected"
                    : "blueprint-entry-button blueprint-blueprint-entry-button"}
                  data-blueprint-id={record.blueprintId}
                  key={record.blueprintId}
                  onClick={() => {
                    setSelectedBlueprintId(record.blueprintId);
                  }}
                  type="button"
                >
                  <span aria-hidden="true" className="button-icon blueprint-entry-icon">
                    <LucideFileText className="button-icon-image" />
                  </span>
                  <span className="blueprint-entry-copy">
                    <span className="blueprint-entry-title">{record.name}</span>
                    <span className="blueprint-entry-description">
                      {record.description.length > 0 ? record.description : copy.noDescription}
                    </span>
                    <span className="blueprint-entry-meta">
                      {copy.detailsEntities}: {record.entityOrder.length} · {copy.detailsUpdatedAt}: {formatBlueprintTimestamp(
                        appHost.state.settings.locale,
                        record.updatedAt,
                      )}
                    </span>
                  </span>
                  <span className="pill">{copy.blueprintBadge}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        {selectedBlueprint === null ? null : renderBlueprintDetails(copy, selectedBlueprint)}
      </div>
    );
  };

  return (
    <div className={isTouchLayout ? "blueprint-panel placement-panel is-touch-layout" : "blueprint-panel placement-panel"}>
      <section
        aria-label={isTouchLayout ? t("workbench.section.blueprintActions") : undefined}
        aria-labelledby={isTouchLayout ? undefined : "blueprint-operation-section"}
        className={isTouchLayout
          ? "placement-panel-group placement-panel-group-operation is-mobile-layout"
          : "placement-panel-group placement-panel-group-operation"}
      >
        {isTouchLayout ? null : (
          <div className="placement-panel-group-header">
            <h3 id="blueprint-operation-section">{t("workbench.section.blueprintActions")}</h3>
          </div>
        )}
        <div className={isTouchLayout
          ? "placement-operation-button-list is-mobile-icon-grid"
          : "placement-button-list placement-operation-button-list"}
        >
          {operationButtons.map((button) => renderOperationButton(button))}
        </div>
        <p className="blueprint-panel-note">{copy.operationsPending}</p>
      </section>

      <div aria-hidden="true" className="placement-panel-divider" />

      <section className="placement-panel-group blueprint-library-group">
        {isTouchLayout ? null : (
          <div className="placement-panel-group-header">
            <h3>{t("workbench.section.blueprintLibrary")}</h3>
          </div>
        )}

        <div aria-label={t("workbench.section.blueprintLibrary")} className="blueprint-tab-list" role="tablist">
          {[
            { id: "system" as const, uiButtonId: "blueprint-tab-system", label: copy.systemTab },
            { id: "user" as const, uiButtonId: "blueprint-tab-user", label: copy.userTab },
          ].map((tab) => {
            const isActive = activeTab === tab.id;

            return (
              <button
                aria-selected={isActive}
                className={isActive ? "blueprint-tab-button is-active" : "blueprint-tab-button"}
                data-ui-button-id={tab.uiButtonId}
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                }}
                role="tab"
                type="button"
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {activeTab === "user" ? renderUserBlueprintDirectory() : (
          <section className="placeholder-section blueprint-empty-state" role="tabpanel">
            <div className="placeholder-section-header">
              <h3>{copy.systemEmptyTitle}</h3>
              <span className="pill">R4</span>
            </div>
            <p>{copy.systemEmptyDescription}</p>
          </section>
        )}
      </section>
    </div>
  );
});

function renderBlueprintDetails(copy: BlueprintPanelCopy, record: BlueprintRecord) {
  return (
    <section className="placeholder-section blueprint-detail-card">
      <div className="placeholder-section-header">
        <h3>{copy.detailsTitle}</h3>
        <span className="pill">{record.version}</span>
      </div>
      <div className="blueprint-entry-copy">
        <span className="blueprint-entry-title">{record.name}</span>
        <span className="blueprint-entry-description">
          {record.description.length > 0 ? record.description : copy.noDescription}
        </span>
      </div>
      <dl className="blueprint-detail-grid">
        <dt>{copy.detailsVersion}</dt>
        <dd>{record.version}</dd>
        <dt>{copy.detailsBase}</dt>
        <dd>{record.baseId}</dd>
        <dt>{copy.detailsEntities}</dt>
        <dd>{record.entityOrder.length}</dd>
        <dt>{copy.detailsLinks}</dt>
        <dd>{record.slotLinks.length}</dd>
        <dt>{copy.detailsUpdatedAt}</dt>
        <dd>{record.updatedAt}</dd>
      </dl>
      <p className="blueprint-panel-note">{copy.previewPending}</p>
    </section>
  );
}