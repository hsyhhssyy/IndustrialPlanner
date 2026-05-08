import type { BlueprintDocument } from "@/domain/document/blueprint-document";

export type BlueprintLibraryKind = "system" | "user";

export interface BlueprintLibraryDescriptor {
  readonly kind: BlueprintLibraryKind;
  readonly isReadOnly: boolean;
  readonly canCreateFolders: boolean;
  readonly labelKey: string;
  readonly emptyStateTitleKey: string;
  readonly emptyStateDescriptionKey: string;
  readonly loadErrorKey: string;
}

export interface BlueprintLibraryFolder {
  readonly folderId: string;
  readonly parentFolderId: string | null;
  readonly name: string;
  readonly updatedAt: string;
}

export interface BlueprintLibraryRecord extends BlueprintDocument {
  readonly parentFolderId: string | null;
  readonly updatedAt: string;
}

export interface BlueprintLibraryDirectoryListing {
  readonly parentFolderId: string | null;
  readonly folders: readonly BlueprintLibraryFolder[];
  readonly blueprints: readonly BlueprintLibraryRecord[];
}

const BLUEPRINT_LIBRARY_DESCRIPTORS: Record<BlueprintLibraryKind, BlueprintLibraryDescriptor> = {
  system: {
    kind: "system",
    isReadOnly: true,
    canCreateFolders: false,
    labelKey: "workbench.tab.systemBlueprints",
    emptyStateTitleKey: "workbench.blueprint.systemEmptyTitle",
    emptyStateDescriptionKey: "workbench.blueprint.systemEmptyDescription",
    loadErrorKey: "workbench.blueprint.systemLoadFailed",
  },
  user: {
    kind: "user",
    isReadOnly: false,
    canCreateFolders: true,
    labelKey: "workbench.tab.userBlueprints",
    emptyStateTitleKey: "workbench.blueprint.emptyDirectoryTitle",
    emptyStateDescriptionKey: "workbench.blueprint.emptyDirectoryDescription",
    loadErrorKey: "workbench.blueprint.libraryLoadFailed",
  },
} satisfies Record<BlueprintLibraryKind, BlueprintLibraryDescriptor>;

export function getBlueprintLibraryDescriptor(kind: BlueprintLibraryKind): BlueprintLibraryDescriptor {
  return BLUEPRINT_LIBRARY_DESCRIPTORS[kind];
}

export function createEmptyBlueprintLibraryDirectory(
  parentFolderId: string | null,
): BlueprintLibraryDirectoryListing {
  return {
    parentFolderId,
    folders: [],
    blueprints: [],
  };
}