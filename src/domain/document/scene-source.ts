import type { EditorQuery } from "../editor/editor-query";
import type { EditorState } from "../editor/editor-state";
import type { RegistryContract } from "../registry/registry-contract";
import type { SceneSnapshotSource } from "../shared/scene-snapshot";
import type { SceneSpace } from "../shared/scene-space";
import type { WorldDocument } from "./world-document";

export interface SceneSourceSnapshot {
  readonly document: WorldDocument;
  readonly space: SceneSpace;
  readonly interaction: Omit<EditorState, "history"> | null;
  readonly poweredEntityIds: readonly string[];
  readonly revision: number;
  readonly disposed: boolean;
}

export type SceneReadQuery = Pick<EditorQuery,
  | "getEntityById" | "listEntities" | "listPowerRangeProvidersCoveringGridRect"
  | "findEntityCollectionGridRect" | "getEntityPlacementValidation" | "getRegionalDarkPipeLinks"
  | "resolveLogisticsDraftState" | "subscribeBaseDocuments"
>;

export interface SceneSource {
  readonly id: string;
  readonly registry: RegistryContract;
  readonly snapshot: SceneSnapshotSource<SceneSourceSnapshot>;
  readonly queries: SceneReadQuery;
}
