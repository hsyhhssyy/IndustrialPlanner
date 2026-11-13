import type { EditorContract } from "../editor/editor-contract";
import type { EditorHistoryActionDescriptor } from "../editor/editor-history";
import type { EditorViewContract } from "../editor/editor-view-contract";
import type { EditorDocumentTransition, EditorSessionPolicy, EditorSessionSnapshot } from "../editor/types/editor-session-types";
import type { EditorViewOptions } from "../editor/types/editor-view-types";
import type { SceneSnapshotSource } from "../shared/scene-snapshot";
import type { SceneSpace } from "../shared/scene-space";
import type { SceneSource } from "./scene-source";
import type { WorldDocument } from "./world-document";

export interface EditableSceneSession<TIntent> {
  readonly source: SceneSource;
  readonly editor: EditorContract;
  readonly snapshot: SceneSnapshotSource<EditorSessionSnapshot<TIntent>>;
  commitIntent(next: TIntent, action: EditorHistoryActionDescriptor): boolean;
  dispose(): void;
}

export interface MemorySceneSessionOptions<TIntent> {
  readonly id: string;
  readonly initialDocument: WorldDocument;
  readonly space: SceneSpace;
  readonly initialIntent: TIntent;
  readonly policy: EditorSessionPolicy<TIntent>;
  readonly reduceIntent: (intent: TIntent, transition: EditorDocumentTransition) => TIntent;
}

export interface ReadonlySceneSourceOptions {
  readonly id: string;
  readonly document: WorldDocument;
  readonly space: SceneSpace;
}

export interface ReadonlySceneSourceController {
  readonly source: SceneSource;
  replace(document: WorldDocument, space: SceneSpace): void;
  dispose(): void;
}

export interface SceneSessionFactories {
  createMemorySession<TIntent>(options: MemorySceneSessionOptions<TIntent>): EditableSceneSession<TIntent>;
  createReadonlySource(options: ReadonlySceneSourceOptions): ReadonlySceneSourceController;
  createView(options: EditorViewOptions): EditorViewContract;
}
