import type { LogisticsMaterialEntityState } from "@/shared/logistics-material"
import {
  Container,
  Graphics,
  Sprite,
  Texture,
} from "pixi.js"

import { resolveDedicatedLogisticTintColor } from "@/renderer/sprites/dedicated-logistic-sprite"
import { resolveDisplayRotationRadians } from "@/shared/geometry/viewport-transform"

import type { DecorationLayer } from "./DecorationLayer"
import type { DecorationSyncContext } from "./DecorationSyncContext"
import {
  resolveBeltPortExtensionEntries,
  resolveViewportPoint,
  resolveVisibleWorldRect,
  isWorldEntityVisible,
  createEntityDefinitionMap,
} from "./BeltVisualGeometry"

const BELT_STRAIGHT_TEXTURE_KEY = "device-sprite-belt_straight_1x1"

type InsertionDynamicSession = ReturnType<DecorationSyncContext["renderHost"]["textureManager"]["acquireLogisticsDynamic"]>

interface BeltInsertionSpriteView {
  readonly root: Container;
  readonly mask: Graphics;
  readonly sprite: Sprite;
  materialState: LogisticsMaterialEntityState | null;
  dynamic: Awaited<ReturnType<NonNullable<DecorationSyncContext["createLogisticsMaterialView"]>>> | null;
  loading: boolean;
}

export function createBeltPortInsertionDecoration(): DecorationLayer {
  const container = new Container()
  const spriteViews: BeltInsertionSpriteView[] = []
  let destroyed = false
  let texture: Texture | null = null
  let materialTexture = false
  let textureVersion = 0
  let dynamicFailed = false
  let generation = 0
  let session: InsertionDynamicSession | null = null
  let assets: Awaited<InsertionDynamicSession["ready"]> | null = null
  let textureLoadStarted = false
  let forceSync = true
  let lastDocumentVersion = -1
  let lastViewportVersion = -1
  let lastCollectionVersion = -1
  let lastPresentationVersion = -1

  const ensureTexture = (ctx: DecorationSyncContext): void => {
    if (textureLoadStarted || texture !== null) {
      return
    }

    textureLoadStarted = true
    const loadingVersion = ++textureVersion
    materialTexture = ctx.logisticsMaterials !== undefined
      && ctx.renderHost.workspace.app?.state.settings.gameUseBlueprintStyleDeviceImages !== true
    const loading = materialTexture ? ctx.renderHost.textureManager.getLogisticsStatic("belt/straight-base")
      : ctx.renderHost.textureManager.getTexture(BELT_STRAIGHT_TEXTURE_KEY)
    void loading.then((loadedTexture) => {
      if (destroyed || loadingVersion !== textureVersion) {
        return
      }

      texture = loadedTexture
      forceSync = true
    })
  }

  const ensureSpriteView = (index: number): BeltInsertionSpriteView => {
    let view = spriteViews[index]
    if (view !== undefined) {
      return view
    }

    const root = new Container()
    const mask = new Graphics({ roundPixels: true })
    const sprite = new Sprite(Texture.EMPTY)
    sprite.anchor.set(0.5)
    sprite.roundPixels = true
    root.mask = mask
    root.addChild(mask)
    root.addChild(sprite)
    container.addChild(root)

    view = {
      root,
      mask,
      sprite,
      materialState: null,
      dynamic: null,
      loading: false,
    }
    spriteViews.push(view)
    return view
  }

  const releaseDynamic = (): void => {
    generation += 1
    for (const view of spriteViews) {
      view.dynamic?.destroy()
      view.dynamic = null
      view.loading = false
      view.sprite.visible = true
    }
    session?.release()
    session = null
    assets = null
  }

  const syncDynamic = (ctx: DecorationSyncContext): void => {
    const frame = ctx.logisticsMaterials
    if (!frame?.animationEnabled) dynamicFailed = false
    const allowed = materialTexture && frame?.animationEnabled === true && container.visible
      && spriteViews.some((view) => view.root.visible)
      && ctx.renderHost.textureManager.supportsLogisticsAnimation()
    if (!allowed || !ctx.createLogisticsMaterialView || !frame) {
      if (session) releaseDynamic()
      return
    }
    if (dynamicFailed) return
    if (!session) {
      const currentGeneration = generation
      session = ctx.renderHost.textureManager.acquireLogisticsDynamic()
      void session.ready.then((loaded) => {
        if (destroyed || generation !== currentGeneration) return
        assets = loaded
      }).catch((error: unknown) => {
        if (destroyed || generation !== currentGeneration) return
        console.error("[LogisticsMaterial] Port extension animation unavailable", error)
        releaseDynamic()
        dynamicFailed = true
      })
    }
    for (const view of spriteViews) {
      if (!view.root.visible || !view.materialState) continue
      if (!view.dynamic && !view.loading && assets) {
        view.loading = true
        const currentGeneration = generation
        void ctx.createLogisticsMaterialView(assets, view.materialState, () => !destroyed && currentGeneration === generation).then((dynamic) => {
          if (!dynamic) return
          if (destroyed || currentGeneration !== generation) { dynamic.destroy(); return }
          view.dynamic = dynamic
          view.root.addChild(dynamic.root)
        }).catch((error: unknown) => console.error("[LogisticsMaterial] Port material unavailable", error))
      }
      if (!view.dynamic) continue
      const root = view.dynamic.root
      root.x = view.sprite.x
      root.y = view.sprite.y
      root.scale.set(ctx.viewportState.gridCellPixelSize / 128)
      root.rotation = -Math.PI / 2
      root.tint = view.sprite.tint
      view.dynamic.sync(view.materialState, frame)
      view.sprite.visible = false
    }
  }

  const hideAll = (): void => {
    container.visible = false
    if (session) releaseDynamic()

    for (const view of spriteViews) {
      view.root.visible = false
    }
  }

  return {
    container,

    sync(ctx: DecorationSyncContext): void {
      if (destroyed) {
        return
      }

      const useMaterialTexture = ctx.logisticsMaterials !== undefined
        && ctx.renderHost.workspace.app?.state.settings.gameUseBlueprintStyleDeviceImages !== true
      if (textureLoadStarted && useMaterialTexture !== materialTexture) {
        textureLoadStarted = false
        texture = null
        forceSync = true
      }
      syncDynamic(ctx)
      const versions = ctx.versions
      if (
        versions !== undefined
        && !forceSync
        && lastDocumentVersion === versions.document
        && lastViewportVersion === versions.viewport
        && lastCollectionVersion === versions.collections
        && lastPresentationVersion === versions.presentation
      ) {
        return
      }
      forceSync = false
      if (versions !== undefined) {
        lastDocumentVersion = versions.document
        lastViewportVersion = versions.viewport
        lastCollectionVersion = versions.collections
        lastPresentationVersion = versions.presentation
      }

      const allEntries = resolveBeltPortExtensionEntries(ctx)
      if (allEntries.length === 0) {
        hideAll()
        return
      }

      // 过滤：只保留 belt 或 device 任一在视口内的 extension
      const editor = ctx.renderHost.workspace.editor
      const definitionMap = createEntityDefinitionMap(ctx)
      const visibleRect = resolveVisibleWorldRect(ctx.viewportState, ctx.viewportBounds)
      const entityById = editor !== null
        ? new Map(editor.queries.listEntities().map((e) => [e.id, e]))
        : new Map()

      const entries = allEntries.filter((entry) => {
        const beltEntity = entityById.get(entry.beltEntityId)
        const deviceEntity = entityById.get(entry.deviceEntityId)
        const beltDef = beltEntity ? definitionMap.get(beltEntity.definitionId) : undefined
        const deviceDef = deviceEntity ? definitionMap.get(deviceEntity.definitionId) : undefined
        return (beltEntity !== undefined && beltDef !== undefined && isWorldEntityVisible(beltEntity, beltDef.footprint, visibleRect))
          || (deviceEntity !== undefined && deviceDef !== undefined && isWorldEntityVisible(deviceEntity, deviceDef.footprint, visibleRect))
      })

      if (entries.length === 0) {
        hideAll()
        return
      }

      ensureTexture(ctx)
      container.visible = true

      const gridCellSize = ctx.viewportState.gridCellPixelSize
      entries.forEach((entry, visibleIndex) => {
        const view = ensureSpriteView(visibleIndex)
        const boundary = resolveViewportPoint({
          point: entry.boundary,
          viewportBounds: ctx.viewportBounds,
          viewportState: ctx.viewportState,
        })

        view.root.visible = texture !== null
        view.root.x = boundary.x
        view.root.y = boundary.y
        view.root.rotation = entry.angleRadians
          + resolveDisplayRotationRadians(ctx.viewportState.displayRotation)

        const localStartX = entry.localStartCells * gridCellSize
        const localEndX = entry.localEndCells * gridCellSize
        view.mask
          .clear()
          .rect(
            localStartX,
            -gridCellSize / 2,
            localEndX - localStartX,
            gridCellSize,
          )
          .fill(0xffffff)

        view.sprite.texture = texture ?? Texture.EMPTY
        view.sprite.x = entry.spriteCenterXCells * gridCellSize
        view.sprite.y = 0
        view.sprite.width = gridCellSize
        view.sprite.height = gridCellSize
        view.sprite.rotation = materialTexture ? -Math.PI / 2 : 0
        const baseState = ctx.logisticsMaterials?.entities.get(entry.beltEntityId)
        view.materialState = baseState ? {
          ...baseState, shape: "straight", rotation: 270,
          start: baseState.start + (entry.kind === "belt-output-to-device" ? 1 : 0) + entry.spriteCenterXCells - .5,
        } : null
        view.sprite.tint = resolveBeltPortExtensionTint(ctx, entry.beltEntityId)
      })

      for (let index = entries.length; index < spriteViews.length; index += 1) {
        const view = spriteViews[index]
        if (view !== undefined) {
          view.root.visible = false
        }
      }
    },

    destroy(): void {
      destroyed = true
      releaseDynamic()

      for (const view of spriteViews) {
        view.root.destroy({ children: true })
      }

      spriteViews.length = 0
      container.destroy({ children: true })
    },
  }
}

function resolveBeltPortExtensionTint(
  ctx: DecorationSyncContext,
  beltEntityId: string,
): number {
  return resolveDedicatedLogisticTintColor({
    entityId: beltEntityId,
    // 虚拟延伸段复用直线传送带 sprite 取色；这是绘图资源 ID，不参与 definition 分类。
    spriteId: "belt_straight_1x1",
    theme: ctx.theme,
    workspace: ctx.renderHost.workspace,
    materialColors: ctx.logisticsMaterials !== undefined && ctx.renderHost.workspace.app?.state.settings.gameUseBlueprintStyleDeviceImages !== true,
  })
}
