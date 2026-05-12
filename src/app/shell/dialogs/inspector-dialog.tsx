import { useCallback, useEffect, useRef, type CSSProperties } from "react";
import { observer } from "mobx-react-lite";

import type { AppHost } from "@/app/host/app-host";
import { EditSelectionInspector } from "@/app/shell/inspector/edit-selection-inspector";
import { DialogShell } from "@/app/shell/shared/dialog-shell";
import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import { createBlueprintDocument } from "@/domain/document/blueprint-document";
import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { BlueprintPreviewHandle } from "@/domain/renderer";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { getRotatedGridFootprint, type GridBounds } from "@/shared/geometry/grid";

const NEIGHBORHOOD_PADDING_CELLS = 4

function shouldUseImmersiveMaximizedDialog(
  screenProfile: AppHost["state"]["screenProfile"],
): boolean {
  return screenProfile.deviceClass === "mobile" || screenProfile.deviceClass === "tablet";
}

/**
 * 以选中设备为中心，footprint 向外扩展 NEIGHBORHOOD_PADDING_CELLS 格，
 * 构造一个合成 BlueprintDocument，仅包含该区域内的实体。
 * 返回 { blueprint, viewportBounds }；若选中实体无效则返回 null。
 */
function buildNeighborhoodBlueprintDocument(options: {
  document: WorldDocument
  selectedEntityId: string
  entityDefinitions: EntityDefinition[]
  paddingCells: number
}): { blueprint: BlueprintDocument; viewportBounds: GridBounds } | null {
  const { document, selectedEntityId, entityDefinitions, paddingCells } = options
  const selectedEntity = document.entities[selectedEntityId]

  if (!selectedEntity) {
    return null
  }

  const definition = entityDefinitions.find((def) => def.id === selectedEntity.definitionId)

  if (!definition) {
    return null
  }

  const rotatedFootprint = getRotatedGridFootprint(definition.footprint, selectedEntity.rotation)
  const expandedLeft = selectedEntity.position.x - paddingCells
  const expandedTop = selectedEntity.position.y - paddingCells
  const expandedWidth = rotatedFootprint.width + paddingCells * 2
  const expandedHeight = rotatedFootprint.height + paddingCells * 2

  const viewportBounds: GridBounds = {
    left: expandedLeft,
    top: expandedTop,
    width: expandedWidth,
    height: expandedHeight,
  }

  // 构建 entityDefinitions map 用于 footprint 计算
  const defMap = new Map<string, EntityDefinition>()
  for (const def of entityDefinitions) {
    defMap.set(def.id, def)
  }

  // 筛选与扩展区域有交集的实体
  const neighborhoodEntities: Record<string, WorldEntity> = {}
  const entityOrder: string[] = []

  for (const entityId of document.entityOrder) {
    const entity = document.entities[entityId]

    if (!entity) {
      continue
    }

    const entityDef = defMap.get(entity.definitionId)

    if (!entityDef) {
      continue
    }

    const entityFootprint = getRotatedGridFootprint(entityDef.footprint, entity.rotation)
    const entityRight = entity.position.x + entityFootprint.width
    const entityBottom = entity.position.y + entityFootprint.height
    const regionRight = expandedLeft + expandedWidth
    const regionBottom = expandedTop + expandedHeight

    const overlaps =
      entityRight > expandedLeft
      && entity.position.x < regionRight
      && entityBottom > expandedTop
      && entity.position.y < regionBottom

    if (overlaps) {
      neighborhoodEntities[entity.id] = entity
      entityOrder.push(entity.id)
    }
  }

  const blueprint = createBlueprintDocument({
    name: "Neighborhood",
    baseId: document.baseId,
    initialGridPoint: { x: expandedLeft, y: expandedTop },
    entities: neighborhoodEntities,
    entityOrder,
    slotLinks: [],
    description: "",
  })

  return { blueprint, viewportBounds }
}

export const InspectorDialog = observer(function InspectorDialog({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const dialogState = appHost.internalState.workbench.dialogState.inspector;
  const isMobileCompactLayout = appHost.state.screenProfile.deviceClass === "mobile";
  const isPhoneLayout = appHost.state.screenProfile.deviceClass === "mobile";
  const initialShellStyle: CSSProperties | undefined = dialogState.width === null && dialogState.height === null
    ? {
      width: isPhoneLayout ? "90%" : "60%",
      height: isPhoneLayout ? "90%" : "80%",
    }
    : undefined;

  const handleClose = useCallback(() => {
    appHost.workspace.editor?.actions.clearCollection(EntityCollectionType.selection);
    appHost.internalActions.hideCanvasFloatingToolbar();
    appHost.internalActions.closeDialog("inspector");
  }, [appHost]);

  // --- Neighborhood preview ---
  const previewCanvasHostRef = useRef<HTMLDivElement | null>(null)
  const previewHandleRef = useRef<BlueprintPreviewHandle | null>(null)
  const editor = appHost.workspace.editor
  const renderHost = appHost.workspace.render
  const selectionIds = editor?.state.collections.selection ?? []
  const selectedEntityId = selectionIds.length === 1 ? selectionIds[0] : null
  const document = editor?.document.getSnapshot() ?? null

  const neighborhoodResult =
    selectedEntityId !== null && document !== null
      ? buildNeighborhoodBlueprintDocument({
        document,
        selectedEntityId,
        entityDefinitions: appHost.workspace.registry.entityDefinitions,
        paddingCells: NEIGHBORHOOD_PADDING_CELLS,
      })
      : null

  useEffect(() => {
    const previewCanvasHost = previewCanvasHostRef.current

    if (
      !dialogState.visible
      || neighborhoodResult === null
      || renderHost === null
      || previewCanvasHost === null
    ) {
      return
    }

    let active = true
    let mountedHandle: BlueprintPreviewHandle | null = null
    const clientWidth = previewCanvasHost.clientWidth
    const clientHeight = previewCanvasHost.clientHeight

    void renderHost.actions.mountNeighborhoodPreview({
      blueprint: neighborhoodResult.blueprint,
      viewportBounds: neighborhoodResult.viewportBounds,
      highlightedEntityId: selectedEntityId!,
      width: clientWidth,
      height: clientHeight,
    }).then((handle) => {
      if (!active) {
        renderHost.actions.disposeBlueprintPreview(handle)
        return
      }

      mountedHandle = handle
      previewHandleRef.current = handle
      const canvas = renderHost.queries.getBlueprintPreviewCanvas(handle)

      if (canvas !== null) {
        previewCanvasHost.replaceChildren(canvas)
      }
    })

    return () => {
      active = false
      previewHandleRef.current = null
      previewCanvasHost?.replaceChildren()

      if (mountedHandle !== null) {
        renderHost.actions.disposeBlueprintPreview(mountedHandle)
      }
    }
  }, [dialogState.visible, neighborhoodResult, renderHost, selectedEntityId])

  // Resize observer for neighborhood preview
  useEffect(() => {
    const previewCanvasHost = previewCanvasHostRef.current

    if (
      !dialogState.visible
      || previewCanvasHost === null
      || renderHost === null
      || typeof ResizeObserver === "undefined"
      || neighborhoodResult === null
    ) {
      return
    }

    const resizeObserver = new ResizeObserver(() => {
      if (previewHandleRef.current === null) {
        return
      }

      renderHost.actions.resizeBlueprintPreview(
        previewHandleRef.current,
        previewCanvasHost.clientWidth,
        previewCanvasHost.clientHeight,
      )
    })

    resizeObserver.observe(previewCanvasHost)

    return () => {
      resizeObserver.disconnect()
    }
  }, [dialogState.visible, renderHost, neighborhoodResult])

  if (!dialogState.visible) {
    return null;
  }

  const showNeighborhoodPreview = neighborhoodResult !== null

  return (
    <DialogShell
      className="inspector-dialog"
      closeTitle={t("action.close")}
      compactMobileLayout={isMobileCompactLayout}
      dialogKey="inspector"
      dialogState={dialogState}
      immersiveMaximized={dialogState.maximized && shouldUseImmersiveMaximizedDialog(appHost.state.screenProfile)}
      maximizeTitle={t("dialog.maximize")}
      onClose={handleClose}
      onOffsetChange={(offsetX, offsetY) => {
        appHost.internalActions.setDialogOffset("inspector", offsetX, offsetY);
      }}
      onResize={isPhoneLayout ? undefined : (width, height) => {
        appHost.internalActions.setDialogSize("inspector", width, height);
      }}
      onToggleMaximized={() => {
        appHost.internalActions.toggleDialogMaximized("inspector");
      }}
      restoreTitle={t("dialog.restore")}
      shellStyle={initialShellStyle}
      showMaximizeButton={!isPhoneLayout}
      title={t("rightDock.selection")}
      titleId="inspector-dialog-title"
    >
      <div className="section-body inspector-dialog-body">
        {showNeighborhoodPreview ? (
          <div className="inspector-dialog-layout">
            <div className="inspector-dialog-neighborhood-preview">
              <div
                className="inspector-dialog-neighborhood-canvas"
                ref={previewCanvasHostRef}
              />
            </div>
            <div className="inspector-dialog-inspector-panel">
              <EditSelectionInspector
                appHost={appHost}
                context={null}
                mode="dialog"
                state={{ locale: appHost.state.settings.locale }}
                translate={t}
              />
            </div>
          </div>
        ) : (
          <EditSelectionInspector
            appHost={appHost}
            context={null}
            mode="dialog"
            state={{ locale: appHost.state.settings.locale }}
            translate={t}
          />
        )}
      </div>
    </DialogShell>
  );
});