import {
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { observer } from "mobx-react-lite";

import type { AppHost } from "@/app/host/app-host";
import {
  resolveInspectorNeighborhoodPreviewModel,
} from "@/app/shell/inspector/inspector-neighborhood-preview-model";
import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import { createBlueprintDocument } from "@/domain/document/blueprint-document";
import type { BlueprintPreviewHandle } from "@/domain/renderer";

const EMPTY_DOCUMENT_SUBSCRIPTION = () => undefined;

export const InspectorNeighborhoodPreview = observer(function InspectorNeighborhoodPreview({
  appHost,
}: {
  appHost: AppHost;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const previewHandleRef = useRef<BlueprintPreviewHandle | null>(null);
  const editor = appHost.workspace.editor;
  const renderHost = appHost.workspace.render;
  const selectedEntityId = editor?.state.collections.selection.length === 1
    ? editor.state.collections.selection[0] ?? null
    : null;
  const documentSnapshot = useSyncExternalStore(
    (listener) => editor?.document.subscribe(listener) ?? EMPTY_DOCUMENT_SUBSCRIPTION,
    () => editor?.document.getSnapshot() ?? null,
    () => editor?.document.getSnapshot() ?? null,
  );
  const entityDefinitionMap = useMemo(
    () => new Map(appHost.workspace.registry.entityDefinitions.map((definition) => [definition.id, definition])),
    [appHost.workspace.registry.entityDefinitions],
  );
  const previewModel = useMemo(
    () => resolveInspectorNeighborhoodPreviewModel({
      document: documentSnapshot,
      entityDefinitionMap,
      selectedEntityId,
    }),
    [documentSnapshot, entityDefinitionMap, selectedEntityId],
  );
  const previewBlueprintDocument = useMemo(
    () => previewModel === null
      ? null
      : createInspectorNeighborhoodBlueprintDocument(previewModel, documentSnapshot?.baseId ?? "wuling_protocol_core"),
    [previewModel, documentSnapshot?.baseId],
  );

  useEffect(() => {
    const canvasHost = canvasHostRef.current;

    if (
      canvasHost === null
      || previewModel === null
      || previewBlueprintDocument === null
      || renderHost === null
    ) {
      canvasHost?.replaceChildren();
      return;
    }

    let active = true;
    let mountedHandle: BlueprintPreviewHandle | null = null;
    const width = Math.max(1, canvasHost.clientWidth);
    const height = Math.max(1, canvasHost.clientHeight);

    void renderHost.actions.mountBlueprintPreview({
      blueprint: previewBlueprintDocument,
      width,
      height,
      viewportBounds: previewModel.bounds,
      highlightedEntityId: previewModel.highlightedEntityId,
    }).then((handle) => {
      if (!active) {
        renderHost.actions.disposeBlueprintPreview(handle);
        return;
      }

      mountedHandle = handle;
      previewHandleRef.current = handle;
      const canvas = renderHost.queries.getBlueprintPreviewCanvas(handle);

      if (canvas !== null) {
        canvas.style.display = "block";
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvasHost.replaceChildren(canvas);
      }
    });

    return () => {
      active = false;
      previewHandleRef.current = null;
      canvasHost?.replaceChildren();

      if (mountedHandle !== null) {
        renderHost.actions.disposeBlueprintPreview(mountedHandle);
      }
    };
  }, [previewModel, previewBlueprintDocument, renderHost]);

  useEffect(() => {
    const canvasHost = canvasHostRef.current;

    if (
      canvasHost === null
      || renderHost === null
      || previewModel === null
      || typeof ResizeObserver === "undefined"
    ) {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      if (previewHandleRef.current === null) {
        return;
      }

      renderHost.actions.resizeBlueprintPreview(
        previewHandleRef.current,
        canvasHost.clientWidth,
        canvasHost.clientHeight,
      );
    });

    resizeObserver.observe(canvasHost);

    return () => {
      resizeObserver.disconnect();
    };
  }, [previewModel, renderHost]);

  const previewAspectRatio = previewModel === null
    ? "1 / 1"
    : `${previewModel.bounds.width} / ${previewModel.bounds.height}`;
  const hostStyle = { aspectRatio: previewAspectRatio } satisfies CSSProperties;

  if (previewModel === null) {
    return null;
  }

  return (
    <aside
      aria-label={appHost.actions.translate("rightDock.selection")}
      className="inspector-neighborhood-preview"
    >
      <div className="inspector-neighborhood-preview-frame" ref={frameRef}>
        <div
          className="inspector-neighborhood-preview-canvas"
          ref={canvasHostRef}
          style={hostStyle}
        />
      </div>
    </aside>
  );
});

function createInspectorNeighborhoodBlueprintDocument(
  model: NonNullable<ReturnType<typeof resolveInspectorNeighborhoodPreviewModel>>,
  baseId: string,
): BlueprintDocument {
  const entities: Record<string, import("@/domain/document/world-document").WorldEntity> = {};

  for (const entry of model.entities) {
    entities[entry.entity.id] = entry.entity;
  }

  return createBlueprintDocument({
    name: "InspectorNeighborhood",
    baseId,
    initialGridPoint: { x: model.bounds.left, y: model.bounds.top },
    entities,
    entityOrder: model.entities.map((entry) => entry.entity.id),
    slotLinks: [],
  });
}