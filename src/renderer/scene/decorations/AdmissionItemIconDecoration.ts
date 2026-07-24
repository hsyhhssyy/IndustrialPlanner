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

import { isLogisticsDefinitionSuppressed } from "@/shared/logistics-suppression";

import type { DecorationLayer } from "./DecorationLayer";
import type { DecorationSyncContext } from "./DecorationSyncContext";
import { createEntityDefinitionMap } from "./BeltVisualGeometry";
import {
  createAdmissionItemIconEntityCache,
} from "./AdmissionItemIconEntityCache";

const ADMISSION_DEFINITION_IDS = new Set([
  "log_admission",
  "pipe_admission",
]);

interface AdmissionIconView {
  readonly root: Container;
  readonly circle: Sprite;
  readonly icon: Sprite;
  currentItemId: string | null;
  iconTextureKey: string | null;
}

interface AdmissionItemIconDecoration extends DecorationLayer {
  sync(
    context: DecorationSyncContext,
    entities?: readonly WorldEntity[],
  ): void;
}

/**
 * 物品准入口图标 Decoration。
 *
 * 当准入口设备（item_log_admission / item_pipe_admission）设置了准入物品时，
 * AI-CORRECTION 2026-07-19: 当前设备定义 ID 为 log_admission / pipe_admission；上行保留迁移前名称。
 * 在设备中心渲染 圆圈 + 物品图标，与主要产物图标样式一致。
 * AI-CORRECTION 2026-07-24: 准入口被压制时，对应物品图标也隐藏。
 */
export function createAdmissionItemIconDecoration(): AdmissionItemIconDecoration {
  const container = new Container();
  const views: AdmissionIconView[] = [];

  // 缓存
  // AI-REMOVED 2026-07-15:
  // Reason: 旧缓存键只包含 document snapshot，遗漏了移动和放置 preview 草稿。
  // Trigger: 配置物品的准入口移动后，图标会延迟出现或在取消后残留，直到平移视口写入 document 才刷新。
  // Evidence: editor.queries.listEntities() 同时返回 document entities 与 state.drafts；移动/取消仅更新 state.drafts。
  // Replacement: AdmissionItemIconEntityCache（document snapshot + preview 草稿实体引用）。
  // Risk: Low - 仅改变准入口图标缓存失效条件。
  // Human Review: Required
  //
  // Original code:
  // let cachedDocumentSnapshot: unknown = null;
  // let admissionEntities: WorldEntity[] | null = null;
  const admissionEntityCache = createAdmissionItemIconEntityCache(
    ADMISSION_DEFINITION_IDS,
  );
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

  // AI-REMOVED 2026-07-15:
  // Reason: 旧 resolver 仅比较 document snapshot，导致草稿实体被遗漏或过期保留。
  // Trigger: 用户报告移动准入口虚影上的物品圆圈延迟出现、取消后残留，pan 后才刷新。
  // Evidence: Playwright 在移动端和桌面端均复现：视口持久化改变 document 后会缓存 move-draft，取消不改变 document 因而残留。
  // Replacement: 下方 resolveAdmissionEntities（document snapshot + preview 草稿实体引用）。
  // Risk: Low - 仅改变缓存失效条件。
  // Human Review: Required
  //
  // Original code:
  // const resolveAdmissionEntities = (
  //   ctx: DecorationSyncContext,
  // ): readonly WorldEntity[] => {
  //   const editor = ctx.renderHost.workspace.editor;
  //   if (editor === null || editor.document === undefined) {
  //     return [];
  //   }
  //
  //   const snapshot = editor.document.getSnapshot();
  //   if (snapshot === null) {
  //     return [];
  //   }
  //
  //   // 文档未变化时复用缓存
  //   if (cachedDocumentSnapshot === snapshot && admissionEntities !== null) {
  //     return admissionEntities;
  //   }
  //
  //   cachedDocumentSnapshot = snapshot;
  //
  //   admissionEntities = editor.queries.listEntities().filter((entity) =>
  //     ADMISSION_DEFINITION_IDS.has(entity.definitionId),
  //   );
  //
  //   return admissionEntities;
  // };
  const resolveAdmissionEntities = (options: {
    ctx: DecorationSyncContext;
    entities: readonly WorldEntity[];
  }): readonly WorldEntity[] => {
    const editor = options.ctx.renderHost.workspace.editor;
    if (editor === null || editor.document === undefined) {
      return [];
    }

    const previewEntities = editor.state.collections.preview.flatMap((entityId) => {
      const entity = editor.queries.getEntityById(entityId);
      return entity === null ? [] : [entity];
    });

    return admissionEntityCache.resolve({
      documentSnapshot: editor.document.getSnapshot(),
      entities: options.entities,
      previewEntities,
    });
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

    sync(ctx: DecorationSyncContext, frameEntities?: readonly WorldEntity[]): void {
      if (destroyed) {
        return;
      }

      const entities = resolveAdmissionEntities({
        ctx,
        entities: frameEntities
          ?? ctx.renderHost.workspace.editor?.queries.listEntities()
          ?? [],
      });
      if (entities.length === 0) {
        hideAll();
        return;
      }

      const editorState = ctx.renderHost.workspace.editor?.state;
      const suppressBelts = editorState?.suppressBelts ?? false;
      const suppressPipes = editorState?.suppressPipes ?? false;

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
        // 被压制的准入口不显示物品图标
        if (isLogisticsDefinitionSuppressed({
          definitionId: entity.definitionId,
          suppressBelts,
          suppressPipes,
        })) {
          continue;
        }

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
