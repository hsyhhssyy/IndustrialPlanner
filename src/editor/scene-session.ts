import type { SceneSessionFactories, MemorySceneSessionOptions, EditableSceneSession } from "@/domain/document/scene-session";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { createEditorRuntime } from "./editor-host";
import { createEditorView } from "./editor-view";
import { createEditableSceneSource, createReadonlySceneSource } from "./scene-source";

export function createSceneSessionFactories(registry: RegistryContract): SceneSessionFactories {
  return {
    createMemorySession: <TIntent>(options: MemorySceneSessionOptions<TIntent>): EditableSceneSession<TIntent> => {
      if (options.id.trim().length === 0) throw new Error("Scene session id is required");
      const editor = createEditorRuntime({ registry, includeBaseBuiltins: false }, {
        persistence: "memory", initialDocument: options.initialDocument, initialIntent: options.initialIntent,
        space: options.space, policy: options.policy, reduceIntent: options.reduceIntent,
      });
      const binding = createEditableSceneSource(options.id, editor);
      return {
        source: binding.source,
        editor: { document: editor.document, actions: editor.actions, queries: editor.queries, state: editor.state },
        snapshot: { getSnapshot: editor.internalSessionSnapshot.getSnapshot, subscribe: editor.internalSessionSnapshot.subscribe },
        commitIntent: editor.internalDocumentWriter.commitIntent,
        dispose: () => { binding.dispose(); editor.dispose(); },
      };
    },
    createReadonlySource: (options) => createReadonlySceneSource(registry, options),
    createView: createEditorView,
  };
}
