import { Container, Graphics, Text } from "pixi.js";

import type { RegionalDarkPipeLink } from "@/shared/dark-pipe-link";
import { resolveAppThemeColorNumber } from "@/shared/theme/app-theme-color";

import type { DecorationLayer } from "./DecorationLayer";
import type { DecorationSyncContext } from "./DecorationSyncContext";
import { createDecorationRedrawGuard } from "./DecorationRedrawGuard";
import { buildEntityDefinitionMap, resolveEntityViewportRect, type ViewportRect } from "./DarkPipeLinkGeometry";
import { layoutRegionalDarkPipeBadge } from "./RegionalDarkPipeLinkGeometry";

interface RegionalDarkPipeLinkDecoration extends DecorationLayer {
  sync(ctx: DecorationSyncContext, links?: readonly RegionalDarkPipeLink[]): void;
}

/** 跨基地关系没有当前画布中的远端坐标，使用设备旁的短虚线标牌表示。 */
export function createRegionalDarkPipeLinkDecoration(): RegionalDarkPipeLinkDecoration {
  const container = new Container();
  container.eventMode = "none";
  const views = new Map<string, {
    root: Container;
    graphics: Graphics;
    label: Text;
    shouldRedraw: ReturnType<typeof createDecorationRedrawGuard>;
  }>();

  return {
    container,
    sync(ctx, links = []) {
      const editor = ctx.renderHost.workspace.editor;
      const app = ctx.renderHost.workspace.app;
      const document = editor?.document.getSnapshot();
      const activeKeys = new Set<string>();
      const occupied: ViewportRect[] = [];
      const definitions = buildEntityDefinitionMap(ctx.renderHost.workspace.registry.entityDefinitions);
      const enabled = app?.state.settings.regionalMultiBaseEnabled === true;
      if (document !== undefined && enabled) {
        for (const link of links) {
          const sending = link.inlet.baseId === document.baseId;
          const local = sending ? link.inlet : link.outlet;
          if (local.baseId !== document.baseId) continue;
          const remote = sending ? link.outlet : link.inlet;
          const entity = editor?.queries.getEntityById(local.entityId);
          const definition = entity == null ? undefined : definitions.get(entity.definitionId);
          if (entity == null || definition === undefined) continue;
          const rect = resolveEntityViewportRect({ ctx, entity, definition });
          if (rect === null
            || rect.left + rect.width < ctx.viewportBounds.left || rect.top + rect.height < ctx.viewportBounds.top
            || rect.left > ctx.viewportBounds.left + ctx.viewportBounds.width
            || rect.top > ctx.viewportBounds.top + ctx.viewportBounds.height) continue;

          const key = `${document.baseId}:${link.id}`;
          activeKeys.add(key);
          let view = views.get(key);
          if (view === undefined) {
            const root = new Container();
            const graphics = new Graphics();
            const label = new Text({ text: "", style: { fontFamily: "system-ui, sans-serif", fontSize: 12, fontWeight: "600" } });
            root.addChild(graphics, label);
            container.addChild(root);
            view = { root, graphics, label, shouldRedraw: createDecorationRedrawGuard() };
            views.set(key, view);
          }
          const base = ctx.renderHost.workspace.registry.baseDefinitions.find((candidate) => candidate.id === remote.baseId);
          const prefix = app?.actions.translate("canvas.regionalDarkPipe") ?? "跨";
          const arrow = sending ? "→" : "←";
          const compact = ctx.viewportState.gridCellPixelSize < 12;
          const text = compact ? `${prefix} ${arrow}` : `${prefix} ${arrow} ${base?.name ?? remote.baseId}`;
          view.label.text = text;
          view.label.resolution = ctx.viewportState.resolution;
          const badge = layoutRegionalDarkPipeBadge({
            entity: rect, viewport: ctx.viewportBounds,
            width: view.label.width + 16, height: 24, occupied,
          });
          occupied.push(badge);
          const color = resolveAppThemeColorNumber(ctx.theme, base === undefined ? "warn" : "accent");
          const background = resolveAppThemeColorNumber(ctx.theme, "surface-1");
          const textColor = resolveAppThemeColorNumber(ctx.theme, "text-0");
          view.label.style.fill = textColor;
          view.label.position.set(Math.round(badge.left + 8), Math.round(badge.top + (badge.height - view.label.height) / 2));
          const startX = rect.left + rect.width / 2;
          const startY = rect.top + rect.height / 2;
          const endX = Math.max(badge.left, Math.min(startX, badge.left + badge.width));
          const endY = Math.max(badge.top, Math.min(startY, badge.top + badge.height));
          if (!view.shouldRedraw([badge.left, badge.top, badge.width, badge.height, startX, startY, endX, endY, color, background])) continue;
          view.graphics.clear();
          const length = Math.hypot(endX - startX, endY - startY);
          for (let distance = 0; distance < length; distance += 8) {
            const end = Math.min(distance + 4, length);
            view.graphics.moveTo(startX + (endX - startX) * distance / length, startY + (endY - startY) * distance / length)
              .lineTo(startX + (endX - startX) * end / length, startY + (endY - startY) * end / length)
              .stroke({ width: 1.5, color, alpha: 0.8 });
          }
          view.graphics.roundRect(badge.left, badge.top, badge.width, badge.height, 5)
            .fill({ color: background, alpha: 0.96 }).stroke({ color, width: 1, alpha: 0.9 });
        }
      }
      for (const [key, view] of views) {
        if (activeKeys.has(key)) continue;
        view.root.destroy({ children: true });
        views.delete(key);
      }
    },
    destroy() {
      container.destroy({ children: true });
      views.clear();
    },
  };
}
