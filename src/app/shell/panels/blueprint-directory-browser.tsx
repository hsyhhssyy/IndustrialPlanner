import type {
  BlueprintLibraryDirectoryListing,
  BlueprintLibraryFolder,
  BlueprintLibraryRecord,
} from "@/shared/blueprints/blueprint-library";
import type { BlueprintLibraryDescriptor } from "@/shared/blueprints/blueprint-library";
import LucideChevronLeft from "~icons/lucide/chevron-left";
import LucideFileText from "~icons/lucide/file-text";
import LucideFolder from "~icons/lucide/folder";
import LucideFolderPlus from "~icons/lucide/folder-plus";
import { BlueprintDetailCard } from "./blueprint-detail-card";
import { BlueprintFolderForm } from "./blueprint-folder-form";

interface BlueprintDirectoryBrowserProps {
  readonly translate: (key: string) => string;
  readonly libraryDescriptor: BlueprintLibraryDescriptor;
  readonly formatTimestamp: (value: string) => string;
  readonly currentFolder: BlueprintLibraryFolder | null;
  readonly folderStack: readonly BlueprintLibraryFolder[];
  readonly directoryListing: BlueprintLibraryDirectoryListing;
  readonly createFolderOpen: boolean;
  readonly createFolderName: string;
  readonly isCreatingFolder: boolean;
  readonly isLoading: boolean;
  readonly errorMessage: string | null;
  readonly selectedBlueprintId: string | null;
  readonly selectedBlueprint: BlueprintLibraryRecord | null;
  readonly onBack: () => void;
  readonly onToggleCreateFolder: () => void;
  readonly onCreateFolderNameChange: (value: string) => void;
  readonly onCreateFolderSubmit: () => void | Promise<void>;
  readonly onCancelCreateFolder: () => void;
  readonly onOpenFolder: (folder: BlueprintLibraryFolder) => void;
  readonly onSelectBlueprint: (blueprintId: string) => void;
}

function formatCountLabel(
  translate: BlueprintDirectoryBrowserProps["translate"],
  count: number,
  singularKey: string,
  pluralKey: string,
): string {
  return `${count} ${translate(count === 1 ? singularKey : pluralKey)}`;
}

export function BlueprintDirectoryBrowser({
  translate,
  libraryDescriptor,
  formatTimestamp,
  currentFolder,
  folderStack,
  directoryListing,
  createFolderOpen,
  createFolderName,
  isCreatingFolder,
  isLoading,
  errorMessage,
  selectedBlueprintId,
  selectedBlueprint,
  onBack,
  onToggleCreateFolder,
  onCreateFolderNameChange,
  onCreateFolderSubmit,
  onCancelCreateFolder,
  onOpenFolder,
  onSelectBlueprint,
}: BlueprintDirectoryBrowserProps) {
  const hasEntries = directoryListing.folders.length > 0 || directoryListing.blueprints.length > 0;

  return (
    <div className="blueprint-library-pane" role="tabpanel">
      <div className="blueprint-browser-toolbar">
        <div className="blueprint-breadcrumb">
          {currentFolder === null ? null : (
            <button
              aria-label={translate("workbench.blueprint.rootFolder")}
              className="blueprint-utility-button blueprint-back-button"
              data-ui-button-id="blueprint-folder-back"
              onClick={onBack}
              type="button"
            >
              <LucideChevronLeft className="button-icon-image" />
            </button>
          )}
          <span className="pill">{translate(libraryDescriptor.labelKey)}</span>
          <span className="blueprint-path-label">
            {currentFolder === null
              ? translate("workbench.blueprint.rootFolder")
              : folderStack.map((folder) => folder.name).join(" / ")}
          </span>
        </div>
        {libraryDescriptor.canCreateFolders ? (
          <button
            className="blueprint-utility-button"
            data-ui-button-id="blueprint-folder-create-toggle"
            onClick={onToggleCreateFolder}
            type="button"
          >
            <LucideFolderPlus className="button-icon-image" />
            <span>{translate("workbench.blueprint.createFolder")}</span>
          </button>
        ) : null}
      </div>

      <div className="blueprint-library-status" aria-live="polite">
        <span className="pill">{formatCountLabel(
          translate,
          directoryListing.folders.length,
          "workbench.blueprint.folderCount.one",
          "workbench.blueprint.folderCount.other",
        )}</span>
        <span className="pill">{formatCountLabel(
          translate,
          directoryListing.blueprints.length,
          "workbench.blueprint.blueprintCount.one",
          "workbench.blueprint.blueprintCount.other",
        )}</span>
      </div>

      {libraryDescriptor.canCreateFolders && createFolderOpen ? (
        <BlueprintFolderForm
          isCreatingFolder={isCreatingFolder}
          onCancel={onCancelCreateFolder}
          onSubmit={onCreateFolderSubmit}
          onValueChange={onCreateFolderNameChange}
          translate={translate}
          value={createFolderName}
        />
      ) : null}

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
          {directoryListing.folders.map((folder) => (
            <button
              className="blueprint-entry-button blueprint-folder-entry-button"
              data-blueprint-folder-id={folder.folderId}
              key={folder.folderId}
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
                  onSelectBlueprint(record.blueprintId);
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

      {selectedBlueprint === null ? null : (
        <BlueprintDetailCard record={selectedBlueprint} translate={translate} />
      )}
    </div>
  );
}