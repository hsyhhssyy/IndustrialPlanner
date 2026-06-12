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
import {
  resolveSharedOutputGroupRows,
  resolvePortTone,
  type OutputGroupRow,
} from "@/app/shell/inspector/port-output-config-model";
import {
  resolvePortPriorityCalloutRows,
  type PortPriorityGroupPortRow,
} from "@/app/shell/inspector/port-priority-group-model";
import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import { createBlueprintDocument } from "@/domain/document/blueprint-document";
import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { INSPECTOR_TYPE } from "@/domain/registry/types/entity-inspector";
import type { BlueprintPreviewHandle } from "@/domain/renderer";
import { resolveRotatedPortGeometry } from "@/shared/geometry/port";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

const EMPTY_DOCUMENT_SUBSCRIPTION = () => undefined;

interface InspectorNeighborhoodPreviewHostSize {
  width: number;
  height: number;
}

interface InspectorPortOutputCallout {
  readonly id: string;
  readonly label: string;
  readonly portKind: "item" | "fluid";
  readonly targetX: number;
  readonly targetY: number;
  readonly labelX: number;
  readonly labelY: number;
  readonly labelWidth: number;
  readonly markerPoints: readonly {
    readonly x: number;
    readonly y: number;
    readonly portId: string;
  }[];
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
  const portOutputCallouts = useMemo(
    () => previewModel === null || hostSize === null
      ? []
      : resolveInspectorPortOutputCallouts({
        bounds: previewModel.bounds,
        document: documentSnapshot,
        entityDefinitionMap,
        height: hostSize.height,
        selectedEntityId,
        width: hostSize.width,
      }),
    [documentSnapshot, entityDefinitionMap, hostSize, previewModel, selectedEntityId],
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
          style={hostStyle}
        >
          <div
            className={cm(styles, "inspector-neighborhood-preview-canvas-stage")}
            ref={canvasHostRef}
          />
          {hostSize === null || portOutputCallouts.length === 0 ? null : (
            <svg
              aria-hidden="true"
              className={cm(styles, "inspector-port-callout-overlay")}
              focusable="false"
              viewBox={`0 0 ${hostSize.width} ${hostSize.height}`}
            >
              {portOutputCallouts.map((callout) => (
                <g
                  className={cm(styles, "inspector-port-callout")}
                  data-port-callout-id={callout.id}
                  data-port-kind={callout.portKind}
                  key={callout.id}
                >
                  <line
                    className={cm(styles, "inspector-port-callout-leader")}
                    x1={callout.targetX}
                    x2={callout.labelX}
                    y1={callout.targetY}
                    y2={callout.labelY}
                  />
                  {callout.markerPoints.map((marker) => (
                    <circle
                      className={cm(styles, "inspector-port-callout-marker")}
                      cx={marker.x}
                      cy={marker.y}
                      data-port-id={marker.portId}
                      key={marker.portId}
                      r="4"
                    />
                  ))}
                  <g
                    className={cm(styles, "inspector-port-callout-label")}
                    transform={`translate(${callout.labelX - callout.labelWidth / 2} ${callout.labelY - 11})`}
                  >
                    <rect height="22" rx="6" width={callout.labelWidth} x="0" y="0" />
                    <text dominantBaseline="central" textAnchor="middle" x={callout.labelWidth / 2} y="11">
                      {callout.label}
                    </text>
                  </g>
                </g>
              ))}
            </svg>
          )}
        </div>
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

export function resolveInspectorPortOutputCallouts(options: {
  readonly bounds: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  };
  readonly document: WorldDocument | null;
  readonly entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
  readonly height: number;
  readonly selectedEntityId: string | null;
  readonly width: number;
}): InspectorPortOutputCallout[] {
  if (options.document === null || options.selectedEntityId === null) {
    return [];
  }

  const entity = options.document.entities[options.selectedEntityId];
  if (entity === undefined) {
    return [];
  }

  const definition = options.entityDefinitionMap.get(entity.definitionId);
  if (definition === undefined) {
    return [];
  }

  /*
    AI-REMOVED 2026-06-05:
    Reason: 蓝图预览端口标签不能只由 portOutputConfig inspector 触发；协议核心通过 warehouseItemLink 独立配置每个输出端口，同样需要端口标签。
    Trigger: 用户指出协议核心是该功能目标场景，仓库链接面板有端口编号但蓝图预览没有端口标签。
    Evidence: Search-First 定位到 resolveSharedOutputGroupRows 已提供 portOutputConfig 优先、无则按输出端口组回退的共享编号模型。
    Replacement: shouldRenderOutputPortCallouts + resolveSharedOutputGroupRows。
    Risk: Medium - 拥有 warehouseItemLink 且存在输出端口的设备现在会在预览中显示 P 标签。
    Human Review: Required

    Original code:
    const declaration = definition.inspectors.find((inspector): inspector is PortOutputConfigInspectorDeclaration =>
      inspector.type === INSPECTOR_TYPE.portOutputConfig,
    );

    if (declaration === undefined) {
      return [];
    }

    const rows = resolveOutputGroupRows(definition, declaration.portGroupIds, entity);
  */
  const cellWidth = options.width / options.bounds.width;
  const cellHeight = options.height / options.bounds.height;
  const priorityRows = resolvePortPriorityCalloutRows(definition, entity);

  if (priorityRows.length > 0) {
    return priorityRows.flatMap((row) => {
      const rowModel = resolveCalloutPortModel({
        definition,
        entity,
        row,
      });

      const target = resolvePreviewPixelPoint({
        bounds: options.bounds,
        cellHeight,
        cellWidth,
        worldX: rowModel.target.x,
        worldY: rowModel.target.y,
      });
      const labelWidth = resolveCalloutLabelWidth(row.portLabel);
      const label = clampCalloutLabelPoint(
        resolvePreviewPixelPoint({
          bounds: options.bounds,
          cellHeight,
          cellWidth,
          worldX: rowModel.label.x,
          worldY: rowModel.label.y,
        }),
        options.width,
        options.height,
        labelWidth,
      );

      return [{
        id: row.portKey,
        label: row.portLabel,
        portKind: row.portKind,
        targetX: target.x,
        targetY: target.y,
        labelX: label.x,
        labelY: label.y,
        labelWidth,
        markerPoints: [{
          portId: row.port.id,
          ...resolvePreviewPixelPoint({
            bounds: options.bounds,
            cellHeight,
            cellWidth,
            worldX: rowModel.markerPoint.x,
            worldY: rowModel.markerPoint.y,
          }),
        }],
      }];
    });
  }

  if (!shouldRenderOutputPortCallouts(definition)) {
    return [];
  }

  const rows = resolveSharedOutputGroupRows(definition, entity);

  return rows.flatMap((row) => {
    const rowModel = resolveCalloutRowModel({
      definition,
      entity,
      row,
    });

    if (rowModel === null) {
      return [];
    }

    const target = resolvePreviewPixelPoint({
      bounds: options.bounds,
      cellHeight,
      cellWidth,
      worldX: rowModel.target.x,
      worldY: rowModel.target.y,
    });
    const labelWidth = resolveCalloutLabelWidth(row.portLabel);
    const label = clampCalloutLabelPoint(
      resolvePreviewPixelPoint({
        bounds: options.bounds,
        cellHeight,
        cellWidth,
        worldX: rowModel.label.x,
        worldY: rowModel.label.y,
      }),
      options.width,
      options.height,
      labelWidth,
    );

    return [{
      id: row.portGroup.id,
      label: row.portLabel,
      portKind: resolvePortTone(row.portGroup),
      targetX: target.x,
      targetY: target.y,
      labelX: label.x,
      labelY: label.y,
      labelWidth,
      markerPoints: rowModel.markerPoints.map((marker) => ({
        portId: marker.portId,
        ...resolvePreviewPixelPoint({
          bounds: options.bounds,
          cellHeight,
          cellWidth,
          worldX: marker.x,
          worldY: marker.y,
        }),
      })),
    }];
  });
}

function resolveCalloutPortModel(options: {
  readonly definition: EntityDefinition;
  readonly entity: WorldEntity;
  readonly row: PortPriorityGroupPortRow;
}): {
  readonly target: { readonly x: number; readonly y: number };
  readonly label: { readonly x: number; readonly y: number };
  readonly markerPoint: { readonly x: number; readonly y: number };
} {
  const geometry = resolveRotatedPortGeometry({
    footprint: options.definition.footprint,
    port: options.row.port,
    rotation: options.entity.rotation,
  });
  const markerPoint = {
    x: options.entity.position.x + geometry.anchor.x,
    y: options.entity.position.y + geometry.anchor.y,
  };

  return {
    target: markerPoint,
    label: {
      x: markerPoint.x + geometry.delta.x * 1.35,
      y: markerPoint.y + geometry.delta.y * 1.35,
    },
    markerPoint,
  };
}

function shouldRenderOutputPortCallouts(definition: EntityDefinition): boolean {
  return definition.inspectors.some(
    (inspector) =>
      inspector.type === INSPECTOR_TYPE.portOutputConfig
      || inspector.type === INSPECTOR_TYPE.warehouseItemLink,
  );
}

function resolveCalloutRowModel(options: {
  readonly definition: EntityDefinition;
  readonly entity: WorldEntity;
  readonly row: OutputGroupRow;
}): {
  readonly target: { readonly x: number; readonly y: number };
  readonly label: { readonly x: number; readonly y: number };
  readonly markerPoints: readonly { readonly portId: string; readonly x: number; readonly y: number }[];
} | null {
  const geometries = options.row.portGroup.ports.map((port) => {
    const geometry = resolveRotatedPortGeometry({
      footprint: options.definition.footprint,
      port,
      rotation: options.entity.rotation,
    });

    return {
      portId: port.id,
      delta: geometry.delta,
      x: options.entity.position.x + geometry.anchor.x,
      y: options.entity.position.y + geometry.anchor.y,
    };
  });

  if (geometries.length === 0) {
    return null;
  }

  const target = {
    x: average(geometries.map((geometry) => geometry.x)),
    y: average(geometries.map((geometry) => geometry.y)),
  };
  const firstDelta = geometries[0]?.delta ?? { x: 0, y: -1 };

  return {
    target,
    label: {
      x: target.x + firstDelta.x * 1.35,
      y: target.y + firstDelta.y * 1.35,
    },
    markerPoints: geometries.map((geometry) => ({
      portId: geometry.portId,
      x: geometry.x,
      y: geometry.y,
    })),
  };
}

function resolvePreviewPixelPoint(options: {
  readonly bounds: {
    readonly left: number;
    readonly top: number;
  };
  readonly cellHeight: number;
  readonly cellWidth: number;
  readonly worldX: number;
  readonly worldY: number;
}): { readonly x: number; readonly y: number } {
  return {
    x: (options.worldX - options.bounds.left) * options.cellWidth,
    y: (options.worldY - options.bounds.top) * options.cellHeight,
  };
}

function clampCalloutLabelPoint(
  point: { readonly x: number; readonly y: number },
  width: number,
  height: number,
  labelWidth: number,
): { readonly x: number; readonly y: number } {
  const halfLabelWidth = labelWidth / 2;

  return {
    x: clamp(point.x, halfLabelWidth + 4, width - halfLabelWidth - 4),
    y: clamp(point.y, 15, height - 15),
  };
}

function resolveCalloutLabelWidth(label: string): number {
  return Math.max(36, label.length * 7 + 14);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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
