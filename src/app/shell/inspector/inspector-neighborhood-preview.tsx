import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
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
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

const EMPTY_DOCUMENT_SUBSCRIPTION = () => undefined;

interface InspectorNeighborhoodPreviewHostSize {
  width: number;
  height: number;
}

export const InspectorNeighborhoodPreview = observer(function InspectorNeighborhoodPreview({
  appHost,
}: {
  appHost: AppHost;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const previewHandleRef = useRef<BlueprintPreviewHandle | null>(null);
  const hostSizeRef = useRef<InspectorNeighborhoodPreviewHostSize | null>(null);
  const [hostSize, setHostSize] = useState<InspectorNeighborhoodPreviewHostSize | null>(null);
  const editor = appHost.workspace.editor;
  const renderHost = appHost.workspace.render;
  hostSizeRef.current = hostSize;
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

  useLayoutEffect(() => {
    const frame = frameRef.current;

    if (frame === null || previewModel === null) {
      setHostSize(null);
      return;
    }

    const syncHostSize = () => {
      const nextHostSize = resolveInspectorNeighborhoodPreviewHostSize({
        frame,
        bounds: previewModel.bounds,
      });

      setHostSize((currentValue) => {
        if (
          currentValue !== null
          && currentValue.width === nextHostSize.width
          && currentValue.height === nextHostSize.height
        ) {
          return currentValue;
        }

        return nextHostSize;
      });
    };

    syncHostSize();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      syncHostSize();
    });

    resizeObserver.observe(frame);

    return () => {
      resizeObserver.disconnect();
    };
  }, [previewModel, previewModel?.bounds.height, previewModel?.bounds.width]);

  useEffect(() => {
    const canvasHost = canvasHostRef.current;

    if (
      canvasHost === null
      || hostSize === null
      || previewModel === null
      || previewBlueprintDocument === null
      || renderHost === null
    ) {
      canvasHost?.replaceChildren();
      return;
    }

    let active = true;
    let mountedHandle: BlueprintPreviewHandle | null = null;

    void renderHost.actions.mountBlueprintPreview({
      blueprint: previewBlueprintDocument,
      width: hostSize.width,
      height: hostSize.height,
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

      const latestHostSize = hostSizeRef.current;

      if (latestHostSize !== null) {
        renderHost.actions.resizeBlueprintPreview(
          handle,
          latestHostSize.width,
          latestHostSize.height,
        );
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
  }, [hostSize, previewModel, previewBlueprintDocument, renderHost]);

  useEffect(() => {
    const frame = frameRef.current;

    if (
      frame === null
      || renderHost === null
      || previewModel === null
      || typeof ResizeObserver === "undefined"
    ) {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      const latestHostSize = hostSizeRef.current;

      if (previewHandleRef.current === null) {
        return;
      }

      if (latestHostSize === null) {
        return;
      }

      renderHost.actions.resizeBlueprintPreview(
        previewHandleRef.current,
        latestHostSize.width,
        latestHostSize.height,
      );
    });

    resizeObserver.observe(frame);

    return () => {
      resizeObserver.disconnect();
    };
  }, [previewModel, renderHost]);

  const hostStyle: CSSProperties = hostSize === null
    ? { aspectRatio: previewModel === null ? "1 / 1" : `${previewModel.bounds.width} / ${previewModel.bounds.height}` }
    : { width: `${hostSize.width}px`, height: `${hostSize.height}px` };

  if (previewModel === null) {
    return null;
  }

  return (
    <aside
      aria-label={appHost.actions.translate("rightDock.selection")}
      className={cm(styles, "inspector-neighborhood-preview")}
    >
      <div className={cm(styles, "inspector-neighborhood-preview-frame")} ref={frameRef}>
        <div
          className={cm(styles, "inspector-neighborhood-preview-canvas")}
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

function resolveInspectorNeighborhoodPreviewHostSize(options: {
  frame: HTMLDivElement;
  bounds: {
    width: number;
    height: number;
  };
}): InspectorNeighborhoodPreviewHostSize {
  const frameStyle = window.getComputedStyle(options.frame);
  const availableWidth = Math.max(
    1,
    Math.floor(
      options.frame.clientWidth
      - parseFloat(frameStyle.paddingLeft)
      - parseFloat(frameStyle.paddingRight),
    ),
  );
  const availableHeight = Math.max(
    1,
    Math.floor(
      options.frame.clientHeight
      - parseFloat(frameStyle.paddingTop)
      - parseFloat(frameStyle.paddingBottom),
    ),
  );

  return resolveAspectFitHostSize({
    availableWidth,
    availableHeight,
    aspectRatio: options.bounds.width / Math.max(1, options.bounds.height),
  });
}

function resolveAspectFitHostSize(options: {
  availableWidth: number;
  availableHeight: number;
  aspectRatio: number;
}): InspectorNeighborhoodPreviewHostSize {
  const normalizedAspectRatio = Number.isFinite(options.aspectRatio) && options.aspectRatio > 0
    ? options.aspectRatio
    : 1;
  const heightFromWidth = options.availableWidth / normalizedAspectRatio;

  if (heightFromWidth <= options.availableHeight) {
    return {
      width: options.availableWidth,
      height: Math.max(1, Math.floor(heightFromWidth)),
    };
  }

  return {
    width: Math.max(1, Math.floor(options.availableHeight * normalizedAspectRatio)),
    height: options.availableHeight,
  };
}