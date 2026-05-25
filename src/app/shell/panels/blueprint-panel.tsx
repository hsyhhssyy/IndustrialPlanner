import { observer } from "mobx-react-lite";
import { useEffect, useRef, useState } from "react";
import type { AppHost } from "@/app/host/app-host";
import {
  createImportedBlueprintDocument,
  parseBlueprintTransferText,
} from "@/app/blueprint/blueprint-transfer";
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
  listBlueprintDirectory,
  readBlueprintFolder,
} from "@/shared/storage/blueprint-storage";
import LucideClipboard from "~icons/lucide/clipboard";
import LucideUpload from "~icons/lucide/upload";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

interface BlueprintOperationButtonDefinition {
  readonly uiButtonId: string;
  readonly labelKey: string;
  readonly compactLabelKey?: string;
  readonly Icon: typeof LucideUpload;
}

function createEmptyBlueprintFolderStacks(): Record<BlueprintLibraryKind, BlueprintLibraryFolder[]> {
  return {
    system: [],
    user: [],
  };
}

function areBlueprintFolderStacksEqual(
  left: readonly BlueprintLibraryFolder[],
  right: readonly BlueprintLibraryFolder[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((folder, index) => {
    const rightFolder = right[index];

    return rightFolder !== undefined
      && folder.folderId === rightFolder.folderId
      && folder.parentFolderId === rightFolder.parentFolderId
      && folder.name === rightFolder.name
      && folder.updatedAt === rightFolder.updatedAt;
  });
}

async function resolveUserBlueprintFolderStack(
  folderIds: readonly string[],
): Promise<BlueprintLibraryFolder[]> {
  const resolvedFolders: BlueprintLibraryFolder[] = [];
  let expectedParentFolderId: string | null = null;

  for (const folderId of folderIds) {
    const folder = await readBlueprintFolder(folderId);

    if (folder === null || folder.parentFolderId !== expectedParentFolderId) {
      return [];
    }

    resolvedFolders.push(folder);
    expectedParentFolderId = folder.folderId;
  }

  return resolvedFolders;
}

function resolveSystemBlueprintFolderStack(options: {
  readonly snapshot: SystemBlueprintLibrarySnapshot;
  readonly folderIds: readonly string[];
}): BlueprintLibraryFolder[] {
  const resolvedFolders: BlueprintLibraryFolder[] = [];
  let currentDirectory = options.snapshot.rootListing;
  let expectedParentFolderId: string | null = null;

  for (const folderId of options.folderIds) {
    const nextFolder = currentDirectory.folders.find((folder) => {
      return folder.folderId === folderId && folder.parentFolderId === expectedParentFolderId;
    });

    if (nextFolder === undefined) {
      return [];
    }

    resolvedFolders.push(nextFolder);
    expectedParentFolderId = nextFolder.folderId;
    currentDirectory = listSystemBlueprintDirectory(options.snapshot, nextFolder.folderId);
  }

  return resolvedFolders;
}

export const BlueprintPanel = observer(function BlueprintPanel({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const isTouchLayout = isMobileOrTabletScreenProfile(appHost.state.screenProfile);
  const isNarrowColumn = !isTouchLayout && appHost.state.workbench.leftDockWidth <= 420;
  const isPanelVisible = (appHost.internalState.runtime.activePanel ?? "placement") === "blueprint";
  const saveBlueprintDialogVisible = appHost.internalState.workbench.dialogState["save-blueprint"].visible;
  const saveBlueprintMutationCompletedCount = appHost.saveBlueprintDialog.completedMutationCount;
  const folderMutationCompletedCount = appHost.blueprintFolderDialog.completedMutationCount;
  const previewMutationCompletedCount = appHost.blueprintPreview.completedMutationCount;
  const [activeTab, setActiveTab] = useState<BlueprintLibraryKind>("user");
  const [folderStacksByLibrary, setFolderStacksByLibrary] = useState<Record<BlueprintLibraryKind, BlueprintLibraryFolder[]>>(
    createEmptyBlueprintFolderStacks,
  );
  const [directoryListing, setDirectoryListing] = useState<BlueprintLibraryDirectoryListing>(
    createEmptyBlueprintLibraryDirectory(null),
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importCompletedCount, setImportCompletedCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedBlueprintId, setSelectedBlueprintId] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const fileImportInputRef = useRef<HTMLInputElement | null>(null);
  const systemBlueprintLibraryRef = useRef<SystemBlueprintLibrarySnapshot | null>(null);
  const folderStack = folderStacksByLibrary[activeTab];
  const currentFolder = folderStack.length > 0 ? folderStack[folderStack.length - 1] ?? null : null;
  const currentFolderId = currentFolder?.folderId ?? null;
  const currentFolderPathSignature = folderStack.map((folder) => folder.folderId).join("/");
  const userFolderStack = folderStacksByLibrary.user;
  const importTargetFolderId = userFolderStack.at(-1)?.folderId ?? null;
  const activeLibrary = getBlueprintLibraryDescriptor(activeTab);
  const selectedBlueprintRecord = directoryListing.blueprints.find((record) => {
    return record.blueprintId === selectedBlueprintId;
  }) ?? null;

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

    const rememberedFolderIds = folderStack.map((folder) => folder.folderId);

    const loadDirectoryListing = async (): Promise<{
      readonly listing: BlueprintLibraryDirectoryListing;
      readonly resolvedFolderStack: BlueprintLibraryFolder[];
    }> => {
      if (activeLibrary.kind === "user") {
        const resolvedFolderStack = await resolveUserBlueprintFolderStack(rememberedFolderIds);
        const resolvedCurrentFolderId = resolvedFolderStack.at(-1)?.folderId ?? null;

        return {
          listing: await listBlueprintDirectory(resolvedCurrentFolderId),
          resolvedFolderStack,
        };
      }

      const systemLibrary = systemBlueprintLibraryRef.current ?? await readSystemBlueprintLibrary();

      systemBlueprintLibraryRef.current = systemLibrary;

      const resolvedFolderStack = resolveSystemBlueprintFolderStack({
        snapshot: systemLibrary,
        folderIds: rememberedFolderIds,
      });
      const resolvedCurrentFolderId = resolvedFolderStack.at(-1)?.folderId ?? null;

      return {
        listing: listSystemBlueprintDirectory(systemLibrary, resolvedCurrentFolderId),
        resolvedFolderStack,
      };
    };

    void loadDirectoryListing()
      .then(({ listing, resolvedFolderStack }) => {
        if (cancelled || requestIdRef.current !== requestId) {
          return;
        }

        setDirectoryListing(listing);
        setFolderStacksByLibrary((currentValue) => {
          const currentFolderStack = currentValue[activeTab];

          if (areBlueprintFolderStacksEqual(currentFolderStack, resolvedFolderStack)) {
            return currentValue;
          }

          return {
            ...currentValue,
            [activeTab]: resolvedFolderStack,
          };
        });
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
  }, [
    activeTab,
    activeLibrary,
    currentFolderId,
    currentFolderPathSignature,
    folderMutationCompletedCount,
    folderStack,
    importCompletedCount,
    isPanelVisible,
    previewMutationCompletedCount,
    saveBlueprintMutationCompletedCount,
    saveBlueprintDialogVisible,
    t,
  ]);

  useEffect(() => {
    appHost.blueprintFolderDialog.close();
    setErrorMessage(null);
    setSelectedBlueprintId(null);
  }, [activeTab, appHost, currentFolderId]);

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

  ];
  const visibleOperationButtons = isTouchLayout
    ? operationButtons.filter((button) => button.compactLabelKey !== undefined)
    : operationButtons;

  const handleImportBlueprintText = async (text: string) => {
    const parsedBlueprint = parseBlueprintTransferText(text);

    if (parsedBlueprint === null) {
      setErrorMessage(t("workbench.blueprint.importInvalid"));
      return;
    }

    setIsImporting(true);
    setErrorMessage(null);

    try {
      appHost.saveBlueprintDialog.openImported(
        createImportedBlueprintDocument(parsedBlueprint),
        importTargetFolderId,
      );

      setActiveTab("user");
      setImportCompletedCount((currentValue) => currentValue + 1);
    } finally {
      setIsImporting(false);
    }
  };

  const handleImportClipboardClick = async () => {
    if (isImporting) {
      return;
    }

    if (typeof navigator === "undefined" || typeof navigator.clipboard?.readText !== "function") {
      setErrorMessage(t("workbench.blueprint.importClipboardUnavailable"));
      return;
    }

    let clipboardText: string;

    try {
      clipboardText = await navigator.clipboard.readText();
    } catch {
      setErrorMessage(t("workbench.blueprint.importClipboardFailed"));
      return;
    }

    await handleImportBlueprintText(clipboardText);
  };

  const handleImportFileInputChange = async (inputElement: HTMLInputElement) => {
    const selectedFile = inputElement.files?.[0] ?? null;

    inputElement.value = "";

    if (selectedFile === null || isImporting) {
      return;
    }

    let fileText: string;

    try {
      fileText = await selectedFile.text();
    } catch {
      setErrorMessage(t("workbench.blueprint.importFileFailed"));
      return;
    }

    await handleImportBlueprintText(fileText);
  };

  const renderOperationButton = (button: BlueprintOperationButtonDefinition) => {
    const label = t(button.labelKey);
    const visibleLabel = isTouchLayout && button.compactLabelKey !== undefined
      ? t(button.compactLabelKey)
      : label;

    return (
      <button
        aria-label={label}
        className={cm(styles, "placement-button placement-action-button blueprint-action-button")}
        data-ui-button-id={button.uiButtonId}
        disabled={isImporting}
        key={button.uiButtonId}
        onClick={() => {
          if (button.uiButtonId === "blueprint-action-import-file") {
            fileImportInputRef.current?.click();
            return;
          }

          if (button.uiButtonId === "blueprint-action-import-clipboard") {
            void handleImportClipboardClick();
          }
        }}
        title={label}
        type="button"
      >
        <span aria-hidden="true" className={cm(styles, "button-icon")}>
          <button.Icon className={cm(styles, "button-icon-image")} />
        </span>
        <span className={cm(styles, "placement-button-label")}>{visibleLabel}</span>
      </button>
    );
  };

  
  return (
    <div className={cm(styles, isTouchLayout
      ? "blueprint-panel placement-panel is-touch-layout"
      : isNarrowColumn
        ? "blueprint-panel placement-panel is-narrow-column"
        : "blueprint-panel placement-panel")}
    >
      <section
        aria-label={isTouchLayout ? t("workbench.section.blueprintActions") : undefined}
        aria-labelledby={isTouchLayout ? undefined : "blueprint-operation-section"}
        className={cm(styles, isTouchLayout
          ? "placement-panel-group placement-panel-group-operation is-mobile-layout"
          : "placement-panel-group placement-panel-group-operation")}
      >
        {isTouchLayout ? null : (
          <div className={cm(styles, "placement-panel-group-header")}>
            <h3 id="blueprint-operation-section">{t("workbench.section.blueprintActions")}</h3>
          </div>
        )}
        {/* 2026-05-09: 蓝图面板在窄左栏下不走四宫格纯图标模式，顶部四个按钮保持单列并保留文字。 */}
        {/* 2026-05-09 订正: 窄左栏蓝图模式顶部现在只保留两个导入按钮，并以双列小字号标签显示。 */}
        <input
          accept=".json,application/json"
          data-blueprint-import-file-input
          hidden
          onChange={(event) => {
            void handleImportFileInputChange(event.currentTarget);
          }}
          ref={fileImportInputRef}
          type="file"
        />
        <div className={cm(styles, isTouchLayout
          ? "placement-button-list placement-operation-button-list blueprint-operation-button-list is-compact-import-actions"
          : "placement-button-list placement-operation-button-list")}
        >
          {visibleOperationButtons.map((button) => renderOperationButton(button))}
        </div>
      </section>

      <div aria-hidden="true" className={cm(styles, "placement-panel-divider")} />

      <section className={cm(styles, "placement-panel-group blueprint-library-group")}>
        {isTouchLayout ? null : (
          <div className={cm(styles, "placement-panel-group-header")}>
            <h3>{t("workbench.section.blueprintLibrary")}</h3>
          </div>
        )}

        <div className={cm(styles, isTouchLayout ? "blueprint-tab-shell is-touch-compact" : "blueprint-tab-shell")}>
          <div className={cm(styles, "blueprint-tab-header")}>
            <div className={cm(styles, "blueprint-tab-strip")}>
              <div
                aria-label={t("workbench.section.blueprintLibrary")}
                className={cm(styles, "blueprint-tab-list")}
                role="tablist"
              >
                {[
                  { id: "system" as const, uiButtonId: "blueprint-tab-system", labelKey: "workbench.tab.systemBlueprints" },
                  { id: "user" as const, uiButtonId: "blueprint-tab-user", labelKey: "workbench.tab.userBlueprints" },
                ].map((tab) => {
                  const isActive = activeTab === tab.id;

                  return (
                    <button
                      aria-selected={isActive}
                      className={cm(styles, isActive
                        ? "blueprint-tab-button dialog-shell-tab is-active"
                        : "blueprint-tab-button dialog-shell-tab")}
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
            </div>
          </div>
        </div>
        <BlueprintDirectoryBrowser
          currentFolder={currentFolder}
          directoryListing={directoryListing}
          errorMessage={errorMessage}
          folderStack={folderStack}
          isLoading={isLoading}
          isTouchLayout={isTouchLayout}
          libraryDescriptor={activeLibrary}
          onBack={() => {
            setFolderStacksByLibrary((currentValue) => ({
              ...currentValue,
              [activeTab]: currentValue[activeTab].slice(0, -1),
            }));
          }}
          onOpenFolder={(folder) => {
            setFolderStacksByLibrary((currentValue) => ({
              ...currentValue,
              [activeTab]: [...currentValue[activeTab], folder],
            }));
          }}
          onEditFolder={(folder) => {
            if (!activeLibrary.canCreateFolders) {
              return;
            }

            appHost.blueprintFolderDialog.openEdit(folder);
          }}
          onSelectBlueprint={(record) => {
            setSelectedBlueprintId(record.blueprintId);
            appHost.blueprintPreview.open(record, {
              canDelete: !activeLibrary.isReadOnly,
            });
          }}
          onToggleCreateFolder={() => {
            if (!activeLibrary.canCreateFolders) {
              return;
            }

            appHost.blueprintFolderDialog.open(currentFolderId);
          }}
          selectedBlueprintId={selectedBlueprintId}
          translate={t}
        />
      </section>
    </div>
  );
});
