import type {
  BlueprintLibraryDirectoryListing,
  BlueprintLibraryFolder,
  BlueprintLibraryRecord,
} from "@/shared/blueprints/blueprint-library";
import type { BlueprintLibraryDescriptor } from "@/shared/blueprints/blueprint-library";
import LucideChevronLeft from "~icons/lucide/chevron-left";
import LucideEdit3 from "~icons/lucide/edit-3";
import LucideFileText from "~icons/lucide/file-text";
import LucideFolder from "~icons/lucide/folder";
import LucideFolderPlus from "~icons/lucide/folder-plus";

interface BlueprintDirectoryBrowserProps {
  readonly translate: (key: string) => string;
  readonly libraryDescriptor: BlueprintLibraryDescriptor;
  readonly isTouchLayout: boolean;
  readonly formatTimestamp: (value: string) => string;
  readonly currentFolder: BlueprintLibraryFolder | null;
  readonly folderStack: readonly BlueprintLibraryFolder[];
  readonly directoryListing: BlueprintLibraryDirectoryListing;
  readonly isLoading: boolean;
  readonly errorMessage: string | null;
  readonly selectedBlueprintId: string | null;
  readonly onBack: () => void;
  readonly onToggleCreateFolder: () => void;
  readonly onOpenFolder: (folder: BlueprintLibraryFolder) => void;
  readonly onEditFolder: (folder: BlueprintLibraryFolder) => void;
  readonly onSelectBlueprint: (record: BlueprintLibraryRecord) => void;
}

function formatBreadcrumbPath(options: {
  readonly translate: BlueprintDirectoryBrowserProps["translate"];
  readonly folderStack: readonly BlueprintLibraryFolder[];
  readonly isTouchLayout: boolean;
}): {
  readonly displayLabel: string;
  readonly fullLabel: string;
} {
  const rootLabel = options.translate("workbench.blueprint.rootFolder");

  if (options.folderStack.length === 0) {
    return {
      displayLabel: rootLabel,
      fullLabel: rootLabel,
    };
  }

  const fullLabel = [rootLabel, ...options.folderStack.map((folder) => folder.name)].join(" / ");

  if (options.isTouchLayout) {
    const currentFolder = options.folderStack.at(-1);

    return {
      displayLabel: currentFolder === undefined ? rootLabel : `../${currentFolder.name}`,
      fullLabel,
    };
  }

  if (options.folderStack.length === 1) {
    return {
      displayLabel: fullLabel,
      fullLabel,
    };
  }

  const currentFolder = options.folderStack.at(-1);

  return {
    displayLabel: `${rootLabel} / … / ${currentFolder?.name ?? ""}`,
    fullLabel,
  };
}

function formatCreateFolderButtonLabel(label: string): string {
  if (label.endsWith("文件夹")) {
    return label.slice(0, Math.max(0, label.length - "文件夹".length)).trim();
  }

  if (/\s+folder$/iu.test(label)) {
    return label.replace(/\s+folder$/iu, "").trim();
  }

  return label;
}

export function BlueprintDirectoryBrowser({
  translate,
  libraryDescriptor,
  isTouchLayout,
  formatTimestamp,
  currentFolder,
  folderStack,
  directoryListing,
  isLoading,
  errorMessage,
  selectedBlueprintId,
  onBack,
  onToggleCreateFolder,
  onOpenFolder,
  onEditFolder,
  onSelectBlueprint,
}: BlueprintDirectoryBrowserProps) {
  const hasEntries = directoryListing.folders.length > 0 || directoryListing.blueprints.length > 0;
  const breadcrumbPath = formatBreadcrumbPath({
    translate,
    folderStack,
    isTouchLayout,
  });
  const createFolderLabel = translate("workbench.blueprint.createFolder");
  const createFolderButtonLabel = formatCreateFolderButtonLabel(createFolderLabel);
  const toolbarStyle = {
    display: "flex",
    alignItems: "center",
    gap: isTouchLayout ? "6px" : "8px",
    flexWrap: "nowrap" as const,
    minWidth: 0,
    width: "100%",
    overflow: "hidden",
    padding: isTouchLayout ? "4px 6px" : "5px 8px",
    border: "1px solid var(--line)",
    borderRadius: isTouchLayout ? "14px" : "16px",
    background: "var(--surface-2)",
  };
  const breadcrumbStyle = {
    display: "flex",
    alignItems: "center",
    gap: isTouchLayout ? "6px" : "8px",
    flex: "1 1 auto",
    width: isTouchLayout ? "auto" : undefined,
    minWidth: 0,
    overflow: "hidden",
    flexWrap: "nowrap" as const,
  };
  const pathLabelStyle = isTouchLayout
    ? {
        display: "block",
        flex: "1 1 auto",
        minWidth: 0,
        color: "var(--text-0)",
        fontSize: "0.86rem",
        fontWeight: 600,
        lineHeight: 1.2,
        whiteSpace: "nowrap" as const,
        overflowX: "auto" as const,
        overflowY: "hidden" as const,
        textOverflow: "clip" as const,
      }
    : {
        display: "block",
        flex: "1 1 auto",
        minWidth: 0,
        color: "var(--text-0)",
        fontSize: "0.9rem",
        fontWeight: 600,
        lineHeight: 1.2,
        whiteSpace: "nowrap" as const,
        overflow: "hidden",
        textOverflow: "ellipsis",
      };
  const navigationButtonStyle = {
    minWidth: isTouchLayout ? "30px" : "32px",
    minHeight: isTouchLayout ? "30px" : "32px",
    padding: 0,
    borderWidth: 0,
    borderRadius: "10px",
    flex: "0 0 auto",
    background: "var(--surface-3)",
  };
  const createButtonStyle = {
    minWidth: isTouchLayout ? "30px" : undefined,
    minHeight: isTouchLayout ? "30px" : "32px",
    width: isTouchLayout ? "30px" : undefined,
    padding: isTouchLayout ? 0 : "0 10px",
    borderWidth: 0,
    borderRadius: "10px",
    flex: "0 0 auto",
    gap: isTouchLayout ? 0 : "5px",
    marginLeft: "auto",
    background: "var(--surface-3)",
    justifyContent: isTouchLayout ? "center" : undefined,
    whiteSpace: "nowrap" as const,
  };

  return (
    <div className="blueprint-library-pane" role="tabpanel">
      <div className="blueprint-browser-toolbar" style={toolbarStyle}>
        <div className="blueprint-breadcrumb" style={breadcrumbStyle}>
          {currentFolder === null ? null : (
            <button
              aria-label={translate("workbench.blueprint.rootFolder")}
              className="blueprint-utility-button blueprint-back-button"
              data-ui-button-id="blueprint-folder-back"
              onClick={onBack}
              style={navigationButtonStyle}
              type="button"
            >
              <LucideChevronLeft className="button-icon-image" />
            </button>
          )}
          {}
          <span
            aria-label={breadcrumbPath.fullLabel}
            className="blueprint-path-label"
            style={pathLabelStyle}
            title={breadcrumbPath.fullLabel}
          >
            {breadcrumbPath.displayLabel}
          </span>
        </div>
        {libraryDescriptor.canCreateFolders ? (
          <button
            aria-label={createFolderLabel}
            className="blueprint-utility-button blueprint-create-button"
            data-ui-button-id="blueprint-folder-create-toggle"
            onClick={onToggleCreateFolder}
            style={createButtonStyle}
            title={createFolderLabel}
            type="button"
          >
            <LucideFolderPlus className="button-icon-image" />
            {isTouchLayout ? null : <span className="blueprint-create-button-label">{createFolderButtonLabel}</span>}
          </button>
        ) : null}
      </div>

      {}

      {}

      {errorMessage === null ? null : (
        <p className="blueprint-panel-error" role="alert">{errorMessage}</p>
      )}

      {isLoading ? <p className="blueprint-panel-note">{translate("workbench.blueprint.loading")}</p> : null}

      {!hasEntries && !isLoading ? (
        <section className="placeholder-section blueprint-empty-state">
          <div className="placeholder-section-header">
            <h3>{translate(libraryDescriptor.emptyStateTitleKey)}</h3>
            <span className="pill">0</span>
          </div>
          <p>{translate(libraryDescriptor.emptyStateDescriptionKey)}</p>
        </section>
      ) : null}

      {hasEntries ? (
        <div className="blueprint-browser-list">
          {directoryListing.folders.map((folder) => {
            const folderEntryButton = (
              <button
                className="blueprint-entry-button blueprint-folder-entry-button"
                data-blueprint-folder-id={folder.folderId}
                onClick={() => {
                  onOpenFolder(folder);
                }}
                type="button"
              >
                <span aria-hidden="true" className="button-icon blueprint-entry-icon">
                  <LucideFolder className="button-icon-image" />
                </span>
                <span className="blueprint-entry-copy">
                  <span className="blueprint-entry-title">{folder.name}</span>
                  <span className="blueprint-entry-meta">{formatTimestamp(folder.updatedAt)}</span>
                </span>
                <span className="pill">{translate("workbench.blueprint.folderBadge")}</span>
              </button>
            );

            if (!libraryDescriptor.canCreateFolders) {
              return (
                <div className="blueprint-entry-row blueprint-folder-entry-row" key={folder.folderId}>
                  {folderEntryButton}
                </div>
              );
            }

            return (
              <div className="blueprint-entry-row blueprint-folder-entry-row" key={folder.folderId}>
                {folderEntryButton}
                <button
                  aria-label={translate("workbench.blueprint.editFolderAction")}
                  className="blueprint-utility-button is-secondary blueprint-folder-edit-button"
                  data-blueprint-folder-edit-id={folder.folderId}
                  onClick={() => {
                    onEditFolder(folder);
                  }}
                  title={translate("workbench.blueprint.editFolderAction")}
                  type="button"
                >
                  <LucideEdit3 className="button-icon-image" />
                </button>
              </div>
            );
          })}

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
                  onSelectBlueprint(record);
                }}
                type="button"
              >
                <span aria-hidden="true" className="button-icon blueprint-entry-icon">
                  <LucideFileText className="button-icon-image" />
                </span>
                <span className="blueprint-entry-copy">
                  <span className="blueprint-entry-title">{record.name}</span>
                  <span className="blueprint-entry-description">
                    {record.description.length > 0
                      ? record.description
                      : translate("workbench.blueprint.noDescription")}
                  </span>
                  <span className="blueprint-entry-meta">
                    {translate("workbench.blueprint.detailsEntities")}: {record.entityOrder.length} · {translate("workbench.blueprint.detailsUpdatedAt")}: {formatTimestamp(record.updatedAt)}
                  </span>
                </span>
                <span className="pill">{translate("workbench.blueprint.blueprintBadge")}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {}
    </div>
  );
}