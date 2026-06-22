import { Container, Sprite, Texture } from "pixi.js";

import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { resolveViewportPointFromWorldPoint } from "@/shared/geometry/viewport-transform";
import { WORLD_GRID_CELL_PIXEL_SIZE } from "@/shared/geometry/viewport-transform";
import {
  DEVICE_LABEL_ICON_SIZE,
  getPrimaryOutputCircleTexture,
} from "@/renderer/sprites/generic-device-sprite";
import type { RenderTextureConfig } from "@/renderer/texture/texture-config";

import type { DecorationLayer } from "./DecorationLayer";
import type { DecorationSyncContext } from "./DecorationSyncContext";
import { createEntityDefinitionMap } from "./BeltVisualGeometry";

const ADMISSION_DEFINITION_IDS = new Set([
  "item_log_admission",
  "item_pipe_admission",
]);

interface AdmissionIconView {
  readonly root: Container;
  readonly circle: Sprite;
  readonly icon: Sprite;
  currentItemId: string | null;
  iconTextureKey: string | null;
}

/**
 * 物品准入口图标 Decoration。
 *
 * 当准入口设备（item_log_admission / item_pipe_admission）设置了准入物品时，
 * 在设备中心渲染 圆圈 + 物品图标，与主要产物图标样式一致。
 * 无视所有标签压制（BeltFamily/PipeFamily）和设置开关，始终显示。
 */
export function createAdmissionItemIconDecoration(): DecorationLayer {
  const container = new Container();
  const views: AdmissionIconView[] = [];

  // 缓存
  let cachedDocumentSnapshot: unknown = null;
  let admissionEntities: WorldEntity[] | null = null;
  let textureConfig: RenderTextureConfig | null = null;
  let destroyed = false;

  const hideAll = (): void => {
    container.visible = false;

    for (const view of views) {
      view.root.visible = false;
    }
  };

  const ensureView = (index: number): AdmissionIconView => {
    let view = views[index];
    if (view !== undefined) {
      return view;
    }

    const root = new Container();
    const circle = new Sprite(Texture.EMPTY);
    circle.anchor.set(0.5);
    circle.roundPixels = true;

    const icon = new Sprite(Texture.EMPTY);
    icon.anchor.set(0.5);
    icon.roundPixels = true;

    root.addChild(circle);
    root.addChild(icon);
    container.addChild(root);

    view = {
      root,
      circle,
      icon,
      currentItemId: null,
      iconTextureKey: null,
    };
    views.push(view);
    return view;
  };

  const resolveAdmissionEntities = (
    ctx: DecorationSyncContext,
  ): readonly WorldEntity[] => {
    const editor = ctx.renderHost.workspace.editor;
    if (editor === null || editor.document === undefined) {
      return [];
    }

    const snapshot = editor.document.getSnapshot();
    if (snapshot === null) {
      return [];
    }

    // 文档未变化时复用缓存
    if (cachedDocumentSnapshot === snapshot && admissionEntities !== null) {
      return admissionEntities;
    }

    cachedDocumentSnapshot = snapshot;

    admissionEntities = editor.queries.listEntities().filter((entity) =>
      ADMISSION_DEFINITION_IDS.has(entity.definitionId),
    );

    return admissionEntities;
  };

  const resolveAdmissionItemId = (
    entity: WorldEntity,
    definition: EntityDefinition,
  ): string | null => {
    for (let gi = 0; gi < definition.portGroups.length; gi += 1) {
      const group = definition.portGroups[gi]!;
      if (group.direction !== "input") {
        continue;
      }

      for (let pi = 0; pi < group.ports.length; pi += 1) {
        const port = group.ports[pi]!;
        if (port.admissionRule === undefined || port.admissionRule === null) {
          continue;
        }

        // 优先读取 entity.config 覆盖值
        const configPath = `portGroups[${gi}].ports[${pi}].admissionRule`;
        const configValue = entity.config[configPath];
        if (configValue !== null && configValue !== undefined && typeof configValue === "object") {
          const itemId = (configValue as Record<string, unknown>).itemId;
          if (typeof itemId === "string" && itemId.length > 0) {
            return itemId;
          }
          // config 中 admissionRule 明确存在但 itemId 为 null/空 → 无准入物品
          return null;
        }

        // 回退到 definition 默认值
        if (port.admissionRule.itemId !== null) {
          return port.admissionRule.itemId;
        }
      }
    }

    return null;
  };

  return {
    container,

    sync(ctx: DecorationSyncContext): void {
      if (destroyed) {
        return;
      }

      const entities = resolveAdmissionEntities(ctx);
      if (entities.length === 0) {
        hideAll();
        return;
      }

      const definitionMap = createEntityDefinitionMap(ctx);
      const vs = ctx.viewportState;
      const vb = ctx.viewportBounds;
      const zoomRatio = Number.isFinite(vs.gridCellPixelSize) && vs.gridCellPixelSize > 0
        ? vs.gridCellPixelSize / WORLD_GRID_CELL_PIXEL_SIZE
        : 1;
      const iconSize = DEVICE_LABEL_ICON_SIZE * zoomRatio;

      // 纹理配置（首次获取后缓存）
      if (textureConfig === null) {
        textureConfig = ctx.renderHost.internalState.textureConfig as RenderTextureConfig;
      }
      const circleTex = getPrimaryOutputCircleTexture(textureConfig!);

      const itemIconById = new Map(
        ctx.renderHost.workspace.registry.itemDefinitions.map((item) => [item.id, item.iconId]),
      );

      let viewIndex = 0;

      for (const entity of entities) {
        const definition = definitionMap.get(entity.definitionId);
        if (definition === undefined) {
          continue;
        }

        const itemId = resolveAdmissionItemId(entity, definition);
        if (itemId === null) {
          continue;
        }

        const view = ensureView(viewIndex);
        viewIndex += 1;

        // 居中于设备中心
        const worldCenterX = entity.position.x + definition.footprint.width / 2;
        const worldCenterY = entity.position.y + definition.footprint.height / 2;
        const viewportPoint = resolveViewportPointFromWorldPoint({
          worldPoint: { x: worldCenterX, y: worldCenterY },
          viewportBounds: { left: vb.left, top: vb.top, width: vb.width, height: vb.height },
          viewportCenter: { x: vs.centerX, y: vs.centerY },
          gridCellPixelSize: vs.gridCellPixelSize,
          displayRotation: vs.displayRotation,
        });

        view.root.x = viewportPoint.x;
        view.root.y = viewportPoint.y;
        view.root.visible = true;

        // 圆圈
        view.circle.texture = circleTex;
        view.circle.width = iconSize;
        view.circle.height = iconSize;

        // 物品图标：先布局尺寸（每帧更新），纹理异步加载
        const insideSize = Math.max(4, Math.floor(iconSize / Math.SQRT2) - 4);
        view.icon.width = insideSize;
        view.icon.height = insideSize;
        view.icon.anchor.set(0.5);

        const iconId = itemIconById.get(itemId);
        const nextTextureKey = iconId !== undefined ? `item-icon-${iconId}` : null;

        if (nextTextureKey !== null && view.iconTextureKey !== nextTextureKey) {
          view.iconTextureKey = nextTextureKey;
          view.icon.texture = Texture.EMPTY;

          void ctx.renderHost.textureManager.getTexture(nextTextureKey).then((texture) => {
            if (destroyed || view.iconTextureKey !== nextTextureKey) {
              return;
            }
            view.icon.texture = texture;
          });
        }

        view.currentItemId = itemId;
      }

      // 隐藏多余的 view
      for (let i = viewIndex; i < views.length; i += 1) {
        views[i]!.root.visible = false;
      }

      container.visible = viewIndex > 0;
    },

    destroy(): void {
      destroyed = true;
      hideAll();
      for (const view of views) {
        view.root.destroy({ children: true });
      }
      views.length = 0;
      container.destroy({ children: true });
    },
  };
}
