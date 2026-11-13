import { reaction } from "mobx";
import type { SceneSource, SceneSourceSnapshot } from "@/domain/document/scene-source";
import type { ReadonlySceneSourceController, ReadonlySceneSourceOptions } from "@/domain/document/scene-session";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { SceneSpace } from "@/domain/shared/scene-space";
import type { WorldDocument } from "@/domain/document/world-document";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import { createSnapshotStore } from "@/shared/snapshot/snapshot-store";
import { freezeSnapshot } from "@/shared/snapshot/freeze-snapshot";
import { validateSceneSpace } from "@/shared/geometry/scene-space";
import { resolveListedEntities } from "./entity-resolvers";
import { resolvePoweredEntityIds, resolvePowerRangeProviders } from "./entity-power";
import { resolvePlacementValidations } from "./placement-validation";
import { resolveEditorSceneSpace } from "./placement-space";
import type { EditorRuntimeHost } from "./editor-host";

/** 只读源只持有文档和查询派生值，不创建 Editor、历史、Workspace 或浏览器资源。 */
export function createReadonlySceneSource(registry: RegistryContract, options: ReadonlySceneSourceOptions): ReadonlySceneSourceController {
  if (options.id.trim().length === 0) throw new Error("Scene source id is required");
  const prepare = (inputDocument: WorldDocument, inputSpace: SceneSpace) => {
    const document = freezeSnapshot(structuredClone(inputDocument));
    const space = freezeSnapshot(structuredClone(inputSpace));
    validateSceneSpace(space);
    const entities = resolveListedEntities({ document, drafts: [] });
    const validation = resolvePlacementValidations({ document,
      workspace: { registry, includeBaseBuiltins: false, placement: {
        space, resolvePlacementAreaIds: (_entity, currentSpace) => currentSpace.areas.map((area) => area.id),
      } },
    });
    return { document, space, entities, validation, poweredEntityIds: resolvePoweredEntityIds(entities, registry) };
  };
  let current = prepare(options.document, options.space);
  const lifetime = createSourceSnapshots({ document: current.document, space: current.space,
    poweredEntityIds: current.poweredEntityIds, interaction: null, revision: 0, disposed: false });
  const source: SceneSource = {
    id: options.id, registry, snapshot: lifetime.source,
    queries: {
      getEntityById: (id) => current.document.entities[id] ?? null,
      listEntities: () => current.entities,
      listPowerRangeProvidersCoveringGridRect: (rect) => resolvePowerRangeProviders(current.entities, registry, rect),
      findEntityCollectionGridRect: () => null,
      getEntityPlacementValidation: (id) => current.validation[id] ?? { canPlace: true, reasons: [] },
      getRegionalDarkPipeLinks: () => [],
      resolveLogisticsDraftState: () => null,
      subscribeBaseDocuments: (listener) => lifetime.source.subscribe((snapshot) => listener([snapshot.document.baseId])),
    },
  };
  return {
    source,
    replace: (document, space) => {
      if (lifetime.source.getSnapshot().disposed) return;
      const next = prepare(document, space);
      current = next;
      lifetime.publish({ document: next.document, space: next.space, interaction: null, poweredEntityIds: next.poweredEntityIds });
    },
    dispose: lifetime.dispose,
  };
}

export function createEditableSceneSource(id: string, editor: EditorRuntimeHost): { source: SceneSource; dispose(): void } {
  if (id.trim().length === 0) throw new Error("Scene source id is required");
  const read = () => ({
    document: editor.document.getSnapshot(),
    space: resolveEditorSceneSpace(editor.services, editor.document.getSnapshot()),
    interaction: {
// AI-REMOVED 2026-11-12: Reason: 相机移至 View；Trigger: REQ-048 D4；Evidence: 旧 viewport 已退役；Replacement: EditorView；Risk: 消费者待迁移；Human Review: Required
// Original code:
//       viewport: editor.state.viewport,
      collections: editor.state.collections, regionAnnotations: editor.state.regionAnnotations,
      hoverTarget: editor.state.hoverTarget, marqueeGridRect: editor.state.marqueeGridRect,
      suppressBelts: editor.state.suppressBelts, suppressPipes: editor.state.suppressPipes,
    },
    poweredEntityIds: [...editor.state.collections[EntityCollectionType.powered]],
  });
  const lifetime = createSourceSnapshots({ ...read(), revision: 0, disposed: false });
  const unsubscribeDocument = editor.document.subscribe(() => lifetime.publish(read()));
  const stopInteraction = reaction(() => {
    const state = editor.state;
    return [
      editor.internalState.drafts,
      ...Object.values(state.collections).map((collection) => [...collection]),
      state.hoverTarget, state.marqueeGridRect, state.suppressBelts, state.suppressPipes,
      { ...state.regionAnnotations, hiddenIds: [...state.regionAnnotations.hiddenIds] },
    ];
  }, () => lifetime.publish(read()));
  const queries = editor.queries;
  return {
    source: {
      id, registry: editor.services.registry, snapshot: lifetime.source,
      queries: {
        getEntityById: queries.getEntityById,
        listEntities: queries.listEntities,
        listPowerRangeProvidersCoveringGridRect: queries.listPowerRangeProvidersCoveringGridRect,
        findEntityCollectionGridRect: queries.findEntityCollectionGridRect,
        getEntityPlacementValidation: queries.getEntityPlacementValidation,
        getRegionalDarkPipeLinks: queries.getRegionalDarkPipeLinks,
        resolveLogisticsDraftState: queries.resolveLogisticsDraftState,
        subscribeBaseDocuments: queries.subscribeBaseDocuments,
      },
    },
    dispose: () => { unsubscribeDocument(); stopInteraction(); lifetime.dispose(); },
  };
}

function createSourceSnapshots(initial: SceneSourceSnapshot) {
  const store = createSnapshotStore<SceneSourceSnapshot>(initial, (value) => Object.freeze(value));
  const subscriptions = new Set<() => void>();
  const source: SceneSource["snapshot"] = {
    getSnapshot: store.getSnapshot,
    subscribe: (listener) => {
      if (store.getSnapshot().disposed) { listener(store.getSnapshot()); return () => {}; }
      const stop = store.subscribe(listener);
      subscriptions.add(stop);
      return () => { subscriptions.delete(stop); stop(); };
    },
  };
  return {
    source,
    publish: (next: Omit<SceneSourceSnapshot, "revision" | "disposed">) => {
      const current = store.getSnapshot();
      if (!current.disposed) store.setSnapshot({ ...next, revision: current.revision + 1, disposed: false });
    },
    dispose: () => {
      const current = store.getSnapshot();
      if (current.disposed) return;
      store.setSnapshot({ ...current, revision: current.revision + 1, disposed: true });
      for (const stop of subscriptions) stop();
      subscriptions.clear();
    },
  };
}
