import { observer } from "mobx-react-lite";
import { useEffect, useRef, useState } from "react";
import type { AppHost } from "@/app/host/app-host";
import { isMobileOrTabletScreenProfile } from "@/shared/browser/screen-profile";
import {
  createEmptyBlueprintLibraryDirectory,
  getBlueprintLibraryDescriptor,
  type BlueprintLibraryDirectoryListing,
  type BlueprintLibraryFolder,
  type BlueprintLibraryKind,
} from "@/shared/blueprints/blueprint-library";
import { BlueprintDirectoryBrowser } from "./blueprint-directory-browser";
import {
  listSystemBlueprintDirectory,
  readSystemBlueprintLibrary,
  type SystemBlueprintLibrarySnapshot,
} from "@/shared/blueprints/system-blueprint-library";
import {
  createBlueprintFolder,
  listBlueprintDirectory,
} from "@/shared/storage/blueprint-storage";
import type { BlueprintLibraryRecord } from "@/shared/blueprints/blueprint-library";
import LucideClipboard from "~icons/lucide/clipboard";
import LucideCopy from "~icons/lucide/copy";
import LucideDownload from "~icons/lucide/download";
import LucideUpload from "~icons/lucide/upload";
import type { BlueprintDetailPlaceEventInput } from "./blueprint-detail-card";

interface BlueprintOperationButtonDefinition {
  readonly uiButtonId: string;
  readonly labelKey: string;
  readonly compactLabelKey?: string;
  readonly Icon: typeof LucideUpload;
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
  const isTouchLayout = isMobileOrTabletScreenProfile(appHost.state.screenProfile);
  const isNarrowColumn = !isTouchLayout && appHost.state.workbench.leftDockWidth <= 420;
  const isPanelVisible = (appHost.internalState.runtime.activePanel ?? "placement") === "blueprint";
  const dialogVisible = appHost.internalState.workbench.dialogState["save-blueprint"].visible;
  const [activeTab, setActiveTab] = useState<BlueprintLibraryKind>("user");
  const [folderStack, setFolderStack] = useState<BlueprintLibraryFolder[]>([]);
  const [directoryListing, setDirectoryListing] = useState<BlueprintLibraryDirectoryListing>(
    createEmptyBlueprintLibraryDirectory(null),
  );
  const [isLoading, setIsLoading] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [createFolderName, setCreateFolderName] = useState("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedBlueprintId, setSelectedBlueprintId] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const systemBlueprintLibraryRef = useRef<SystemBlueprintLibrarySnapshot | null>(null);
  const currentFolder = folderStack.length > 0 ? folderStack[folderStack.length - 1] ?? null : null;
  const currentFolderId = currentFolder?.folderId ?? null;
  const selectedBlueprint = directoryListing.blueprints.find(
    (record) => record.blueprintId === selectedBlueprintId,
  ) ?? null;
  const activeLibrary = getBlueprintLibraryDescriptor(activeTab);
  const formatTimestamp = (value: string) => formatBlueprintTimestamp(appHost.state.settings.locale, value);

  useEffect(() => {
    if (!isPanelVisible) {
      return;
    }

    let cancelled = false;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setIsLoading(true);
    setErrorMessage(null);
    setDirectoryListing(createEmptyBlueprintLibraryDirectory(currentFolderId));

    const loadDirectoryListing = async (): Promise<BlueprintLibraryDirectoryListing> => {
      if (activeLibrary.kind === "user") {
        return await listBlueprintDirectory(currentFolderId);
      }

      const systemLibrary = systemBlueprintLibraryRef.current ?? await readSystemBlueprintLibrary();

      systemBlueprintLibraryRef.current = systemLibrary;

      return listSystemBlueprintDirectory(systemLibrary, currentFolderId);
    };

    void loadDirectoryListing()
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
      .catch(() => {
        if (cancelled || requestIdRef.current !== requestId) {
          return;
        }

        setErrorMessage(t(activeLibrary.loadErrorKey));
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
  }, [activeLibrary, currentFolderId, dialogVisible, isPanelVisible, reloadVersion, t]);

  useEffect(() => {
    setCreateFolderOpen(false);
    setCreateFolderName("");
    setErrorMessage(null);
    setSelectedBlueprintId(null);
  }, [activeTab, currentFolderId]);

  const operationButtons: readonly BlueprintOperationButtonDefinition[] = [
    {
      uiButtonId: "blueprint-action-import-file",
      labelKey: "workbench.button.importBlueprintFromFile",
      compactLabelKey: "workbench.button.importBlueprintFromFileCompact",
      Icon: LucideUpload,
    },
    {
      uiButtonId: "blueprint-action-import-clipboard",
      labelKey: "workbench.button.importBlueprintFromClipboard",
      compactLabelKey: "workbench.button.importBlueprintFromClipboardCompact",
      Icon: LucideClipboard,
    },
    {
      uiButtonId: "blueprint-action-export-file",
      labelKey: "workbench.button.exportBlueprintToFile",
      Icon: LucideDownload,
    },
    {
      uiButtonId: "blueprint-action-copy-clipboard",
      labelKey: "workbench.button.copyBlueprintToClipboard",
      Icon: LucideCopy,
    },
  ];
  const visibleOperationButtons = isTouchLayout
    ? operationButtons.filter((button) => button.compactLabelKey !== undefined)
    : operationButtons;

  const handleCreateFolder = async () => {
    if (!activeLibrary.canCreateFolders || isCreatingFolder) {
      return;
    }

    const normalizedName = createFolderName.trim();

    if (normalizedName.length === 0) {
      setErrorMessage(t("workbench.blueprint.folderNameRequired"));
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
      setErrorMessage(t("workbench.blueprint.folderCreateFailed"));
      return;
    }

    setCreateFolderOpen(false);
    setCreateFolderName("");
    setReloadVersion((currentValue) => currentValue + 1);
  };

  const renderOperationButton = (button: BlueprintOperationButtonDefinition) => {
    const label = t(button.labelKey);
    const visibleLabel = isTouchLayout && button.compactLabelKey !== undefined
      ? t(button.compactLabelKey)
      : label;

    return (
      <button
        aria-label={label}
        className="placement-button placement-action-button blueprint-action-button"
        data-ui-button-id={button.uiButtonId}
        disabled
        key={button.uiButtonId}
        title={label}
        type="button"
      >
        <span aria-hidden="true" className="button-icon">
          <button.Icon className="button-icon-image" />
        </span>
        <span className="placement-button-label">{visibleLabel}</span>
      </button>
    );
  };

  const handlePlaceBlueprintFromLibrary = (
    record: BlueprintLibraryRecord,
    input: BlueprintDetailPlaceEventInput,
  ) => {
    if (appHost.workspace.editor === null) {
      return;
    }

    appHost.blueprintPreview.open(record);

    if (input.source === "mouse") {
      appHost.gestureAdapter.handleUiButtonMouseTap({
        uiButtonId: "blueprint-preview-place-button",
        button: input.button,
        altKey: input.altKey,
        ctrlKey: input.ctrlKey,
        metaKey: input.metaKey,
        shiftKey: input.shiftKey,
        sourceEvent: input.sourceEvent,
      });
      return;
    }

    appHost.gestureAdapter.handleUiButtonTouchTap({
      uiButtonId: "blueprint-preview-place-button",
      altKey: input.altKey,
      ctrlKey: input.ctrlKey,
      metaKey: input.metaKey,
      shiftKey: input.shiftKey,
      sourceEvent: input.sourceEvent,
    });
  };

  return (
    <div className={isTouchLayout
      ? "blueprint-panel placement-panel is-touch-layout"
      : isNarrowColumn
        ? "blueprint-panel placement-panel is-narrow-column"
        : "blueprint-panel placement-panel"}
    >
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
        {/* 2026-05-09: 蓝图面板在窄左栏下不走四宫格纯图标模式，顶部四个按钮保持单列并保留文字。 */}
        {/* 2026-05-09 订正: 窄左栏蓝图模式顶部现在只保留两个导入按钮，并以双列小字号标签显示。 */}
        <div className={isTouchLayout
          ? "placement-button-list placement-operation-button-list blueprint-operation-button-list is-compact-import-actions"
          : "placement-button-list placement-operation-button-list"}
        >
          {visibleOperationButtons.map((button) => renderOperationButton(button))}
        </div>
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
            { id: "system" as const, uiButtonId: "blueprint-tab-system", labelKey: "workbench.tab.systemBlueprints" },
            { id: "user" as const, uiButtonId: "blueprint-tab-user", labelKey: "workbench.tab.userBlueprints" },
          ].map((tab) => {
            const isActive = activeTab === tab.id;

            return (
              <button
                aria-selected={isActive}
                className={isActive ? "pill blueprint-tab-button is-active" : "pill blueprint-tab-button"}
                data-ui-button-id={tab.uiButtonId}
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                }}
                role="tab"
                type="button"
              >
                {t(tab.labelKey)}
              </button>
            );
          })}
        </div>
        <BlueprintDirectoryBrowser
          createFolderName={createFolderName}
          createFolderOpen={activeLibrary.canCreateFolders && createFolderOpen}
          currentFolder={currentFolder}
          directoryListing={directoryListing}
          errorMessage={errorMessage}
          folderStack={folderStack}
          formatTimestamp={formatTimestamp}
          isCreatingFolder={isCreatingFolder}
          isLoading={isLoading}
          libraryDescriptor={activeLibrary}
          onBack={() => {
            setFolderStack((currentValue) => currentValue.slice(0, -1));
          }}
          onCancelCreateFolder={() => {
            setCreateFolderOpen(false);
            setCreateFolderName("");
            setErrorMessage(null);
          }}
          onCreateFolderNameChange={(value) => {
            setCreateFolderName(value);
            if (errorMessage !== null) {
              setErrorMessage(null);
            }
          }}
          onCreateFolderSubmit={handleCreateFolder}
          onOpenFolder={(folder) => {
            setFolderStack((currentValue) => [...currentValue, folder]);
          }}
          onPlaceBlueprint={handlePlaceBlueprintFromLibrary}
          onSelectBlueprint={(record) => {
            setSelectedBlueprintId(record.blueprintId);
            appHost.blueprintPreview.open(record);
          }}
          onToggleCreateFolder={() => {
            if (!activeLibrary.canCreateFolders) {
              return;
            }

            setCreateFolderOpen((currentValue) => !currentValue);
            setErrorMessage(null);
          }}
          selectedBlueprint={selectedBlueprint}
          selectedBlueprintId={selectedBlueprintId}
          translate={t}
        />
      </section>
    </div>
  );
});