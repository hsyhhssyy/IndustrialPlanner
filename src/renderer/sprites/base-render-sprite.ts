import { EntityCollectionType, type EntityCollectionType as EntityCollectionTypeValue } from "@/domain/editor/types/editor-types";
import { Container } from "pixi.js";

import type {
  RenderLayerId,
  RenderLayerMap,
  RenderSprite,
  RenderSpriteLayout,
  RenderSpriteSyncContext,
} from "./render-sprite";

const DEFAULT_COLLECTION_SYNC_ORDER: readonly EntityCollectionTypeValue[] = [
  EntityCollectionType.ghost,
  EntityCollectionType.preview,
  EntityCollectionType.marquee,
  EntityCollectionType.reverseMarquee,
  EntityCollectionType.selection,
];

export abstract class BaseRenderSprite implements RenderSprite {
  private currentLayerMap: RenderLayerMap | null = null;
  private readonly layerRoots = new Map<RenderLayerId, Container>();
  private destroyed = false;

  protected constructor(
    protected readonly entityId: string,
  ) {}

  public attach(layers: RenderLayerMap): void {
    this.ensureNotDestroyed();

    if (this.currentLayerMap === layers) {
      return;
    }

    this.detach();
    this.currentLayerMap = layers;

    for (const [layerId, root] of this.layerRoots) {
      layers[layerId].addChild(root);
    }
  }

  public syncLayout(layout: RenderSpriteLayout, context: RenderSpriteSyncContext): void {
    this.ensureNotDestroyed();

    this.syncSpriteLayout(layout, context);
    this.resetCollectionOverlay(layout, context);

    this.syncCollectionOverlay(
      this.resolveCurrentCollectionOverlayTypes(context),
      layout,
      context,
    );

    this.afterSyncLayout(layout, context);
  }

  public destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.onDestroy();
    this.detach();

    for (const root of this.layerRoots.values()) {
      root.destroy({ children: true });
    }

    this.layerRoots.clear();
  }

  public setVisible(visible: boolean): void {
    this.ensureNotDestroyed();

    for (const root of this.layerRoots.values()) {
      root.visible = visible;
    }
  }

  protected abstract syncSpriteLayout(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void;

  /** 由子类实现，重置 collection overlay（如清空 Graphics、隐藏扫描线等） */
  protected abstract resetCollectionOverlay(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void;

  protected syncCollectionOverlay(
    collectionTypes: readonly EntityCollectionTypeValue[],
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void {
    const activeCollectionTypeSet = new Set(collectionTypes);

    if (activeCollectionTypeSet.has(EntityCollectionType.ghost)) {
      this.drawGhostOverlay(layout, context);
    }

    if (activeCollectionTypeSet.has(EntityCollectionType.preview)) {
      this.drawPreviewOverlay(layout, context);
    }

    if (
      activeCollectionTypeSet.has(EntityCollectionType.marquee)
      || (
        activeCollectionTypeSet.has(EntityCollectionType.selection)
        && !activeCollectionTypeSet.has(EntityCollectionType.reverseMarquee)
      )
    ) {
      this.drawSelectionOverlay(layout, context);
    }
  }

  protected afterSyncLayout(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void {
    void layout;
    void context;
  }

  protected onDestroy(): void {}

  /** ghost 特效绘制，由子类实现 */
  protected abstract drawGhostOverlay(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void;

  /** preview 特效绘制，由子类实现 */
  protected abstract drawPreviewOverlay(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void;

  /** selection/marquee 特效绘制，由子类实现 */
  protected abstract drawSelectionOverlay(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void;

  protected resolveCollectionSyncOrder(
    context: RenderSpriteSyncContext,
  ): readonly EntityCollectionTypeValue[] {
    void context;
    return DEFAULT_COLLECTION_SYNC_ORDER;
  }

  private resolveCurrentCollectionOverlayTypes(
    context: RenderSpriteSyncContext,
  ): readonly EntityCollectionTypeValue[] {
    return this.resolveCollectionSyncOrder(context).filter((collectionType) =>
      this.isCurrentEntityInCollection(collectionType, context),
    );
  }

  protected getRootOfLayer(layerId: RenderLayerId): Container {
    this.ensureNotDestroyed();

    const existingRoot = this.layerRoots.get(layerId);
    if (existingRoot !== undefined) {
      return existingRoot;
    }

    const root = new Container();
    this.layerRoots.set(layerId, root);

    if (this.currentLayerMap !== null) {
      this.currentLayerMap[layerId].addChild(root);
    }

    return root;
  }

  /** 返回所有已创建的层容器，供子类批量调整 alpha/visible 等属性 */
  protected getAllRoots(): IterableIterator<Container> {
    return this.layerRoots.values();
  }

  protected isCurrentEntityInCollection(
    collectionType: EntityCollectionTypeValue,
    context: RenderSpriteSyncContext,
  ): boolean {
    return context.workspace.editor!.state.collections[collectionType].contains(this.entityId);
  }

  protected resolveWorkspaceGridCellPixelSize(context: RenderSpriteSyncContext): number {
    return context.workspace.editor!.state.viewport.gridCellPixelSize;
  }

  private detach(): void {
    for (const root of this.layerRoots.values()) {
      if (root.parent !== null) {
        root.parent.removeChild(root);
      }
    }

    this.currentLayerMap = null;
  }

  private ensureNotDestroyed(): void {
    if (this.destroyed) {
      throw new Error("Cannot use a destroyed render sprite.");
    }
  }
}

