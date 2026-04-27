import type { WorkspaceContract } from "@/domain/contract/workspace-contract";
import { EntityCollectionType, type EntityCollectionType as EntityCollectionTypeValue } from "@/domain/state/types";
import { resolveAppThemeColorNumber } from "@/shared/theme/app-theme-color";
import { Container, Graphics } from "pixi.js";

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

const DEFAULT_GHOST_ROOT_ALPHA = 0.2;
const WORLD_ENTITY_SELECTION_STROKE_MIN_WIDTH = 1;
const WORLD_ENTITY_SELECTION_STROKE_MAX_WIDTH = 4;

export abstract class BaseRenderSprite implements RenderSprite {
  private currentLayerMap: RenderLayerMap | null = null;
  private readonly layerRoots = new Map<RenderLayerId, Container>();
  private defaultCollectionOverlayGraphics: Graphics | null = null;
  private rootAlpha = 1;
  private rootVisible = true;
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

  protected abstract syncSpriteLayout(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void;

  protected resetCollectionOverlay(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void {
    void layout;
    void context;

    this.setAllRootAlpha(1);
    this.setAllRootVisible(true);
    this.defaultCollectionOverlayGraphics?.clear();
  }

  protected syncCollectionOverlay(
    collectionTypes: readonly EntityCollectionTypeValue[],
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void {
    const activeCollectionTypeSet = new Set(collectionTypes);

    if (activeCollectionTypeSet.has(EntityCollectionType.ghost)) {
      this.drawDefaultGhostOverlay(layout, context);
    }

    if (activeCollectionTypeSet.has(EntityCollectionType.preview)) {
      this.drawDefaultPreviewOverlay(layout, context);
    }

    if (
      activeCollectionTypeSet.has(EntityCollectionType.marquee)
      || (
        activeCollectionTypeSet.has(EntityCollectionType.selection)
        && !activeCollectionTypeSet.has(EntityCollectionType.reverseMarquee)
      )
    ) {
      this.drawDefaultSelectionOverlay(layout, context);
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

  protected drawDefaultGhostOverlay(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void {
    void layout;
    void context;

    this.setAllRootAlpha(DEFAULT_GHOST_ROOT_ALPHA);
  }

  protected drawDefaultPreviewOverlay(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void {
    this.drawCollectionOverlayStroke({
      layout,
      color: this.resolvePreviewCollectionOverlayColor(context),
      width: this.resolvePreviewCollectionOverlayStrokeWidth(context),
    });
  }

  protected drawDefaultSelectionOverlay(
    layout: RenderSpriteLayout,
    context: RenderSpriteSyncContext,
  ): void {
    this.drawCollectionOverlayStroke({
      layout,
      color: this.resolveSelectionCollectionOverlayColor(context),
      width: this.resolveSelectionCollectionOverlayStrokeWidth(context),
    });
  }

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

    const root = this.createRootOfLayer(layerId);
    this.layerRoots.set(layerId, root);

    if (this.currentLayerMap !== null) {
      this.currentLayerMap[layerId].addChild(root);
    }

    return root;
  }

  protected getExistingRootOfLayer(layerId: RenderLayerId): Container | null {
    return this.layerRoots.get(layerId) ?? null;
  }

  protected createRootOfLayer(layerId: RenderLayerId): Container {
    void layerId;

    const root = new Container();
    root.alpha = this.rootAlpha;
    root.visible = this.rootVisible;
    return root;
  }

  protected setLayerRootAlpha(layerId: RenderLayerId, alpha: number): void {
    this.getRootOfLayer(layerId).alpha = alpha;
  }

  protected setLayerRootVisible(layerId: RenderLayerId, visible: boolean): void {
    this.getRootOfLayer(layerId).visible = visible;
  }

  protected setAllRootAlpha(alpha: number): void {
    this.rootAlpha = alpha;

    for (const root of this.layerRoots.values()) {
      root.alpha = alpha;
    }
  }

  protected setAllRootVisible(visible: boolean): void {
    this.rootVisible = visible;

    for (const root of this.layerRoots.values()) {
      root.visible = visible;
    }
  }

  protected getCollectionOverlayGraphics(): Graphics {
    this.ensureNotDestroyed();

    if (this.defaultCollectionOverlayGraphics !== null) {
      return this.defaultCollectionOverlayGraphics;
    }

    const graphics = new Graphics({ roundPixels: true });
    this.getRootOfLayer("overlay").addChild(graphics);
    this.defaultCollectionOverlayGraphics = graphics;
    return graphics;
  }

  protected resolveSelectionCollectionOverlayStrokeWidth(
    context: RenderSpriteSyncContext,
  ): number {
    return resolveWorldEntitySelectionStrokeWidth(this.resolveWorkspaceGridCellPixelSize(context));
  }

  protected resolveSelectionCollectionOverlayColor(
    context: RenderSpriteSyncContext,
  ): number {
    return resolveAppThemeColorNumber(
      context.theme,
      context.theme.renderer.worldEntitySelectionStrokeColorKey,
    );
  }

  protected resolvePreviewCollectionOverlayStrokeWidth(
    context: RenderSpriteSyncContext,
  ): number {
    return this.resolveSelectionCollectionOverlayStrokeWidth(context) * 2;
  }

  protected resolvePreviewCollectionOverlayColor(
    context: RenderSpriteSyncContext,
  ): number {
    return resolveAppThemeColorNumber(
      context.theme,
      context.theme.renderer.spritePreviewBorderBoxColorKey,
    );
  }

  protected isCurrentEntityInCollection(
    collectionType: EntityCollectionTypeValue,
    context: RenderSpriteSyncContext,
  ): boolean {
    const editor = requireWorkspaceEditor(context);
    return editor.state.collections[collectionType].contains(this.entityId);
  }

  protected getWorkspace(context: RenderSpriteSyncContext): WorkspaceContract {
    return context.workspace;
  }

  protected resolveWorkspaceGridCellPixelSize(context: RenderSpriteSyncContext): number {
    return requireWorkspaceEditor(context).state.viewport.gridCellPixelSize;
  }

  protected drawCollectionOverlayStroke(options: {
    layout: RenderSpriteLayout;
    color: number;
    width: number;
  }): void {
    const innerRect = resolveInnerStrokeRect(options.layout, options.width);
    if (innerRect === null) {
      return;
    }

    this.getCollectionOverlayGraphics()
      .rect(innerRect.x, innerRect.y, innerRect.width, innerRect.height)
      .stroke({
        width: options.width,
        color: options.color,
      });
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

function resolveWorldEntitySelectionStrokeWidth(gridCellPixelSize: number): number {
  const width = gridCellPixelSize / 8;

  return Math.max(
    WORLD_ENTITY_SELECTION_STROKE_MIN_WIDTH,
    Math.min(WORLD_ENTITY_SELECTION_STROKE_MAX_WIDTH, width),
  );
}

function requireWorkspaceEditor(
  context: RenderSpriteSyncContext,
): NonNullable<RenderSpriteSyncContext["workspace"]["editor"]> {
  const editor = context.workspace.editor;

  if (editor === null) {
    throw new Error("Render sprites require an initialized editor host.");
  }

  return editor;
}

function resolveInnerStrokeRect(
  layout: RenderSpriteLayout,
  strokeWidth: number,
): {
  x: number;
  y: number;
  width: number;
  height: number;
} | null {
  const inset = Math.min(
    strokeWidth / 2,
    layout.width / 2,
    layout.height / 2,
  );
  const width = layout.width - inset * 2;
  const height = layout.height - inset * 2;

  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    x: layout.x + inset,
    y: layout.y + inset,
    width,
    height,
  };
}
