import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import type { BlueprintPreviewOverlay } from "@/domain/renderer";
import type { WorldEntity } from "@/domain/document/world-document";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";

/** 静态生产图标与逻辑连接，仅表达准备状态，不接入仿真。 */
export class BlueprintPreviewOverlayDecoration {
  readonly container = new Container();
  private readonly graphics = this.container.addChild(new Graphics());
  private readonly icons = new Map<string, Sprite>();
  private signature = "";
  private disposed = false;

  sync(overlay: BlueprintPreviewOverlay | undefined, entities: readonly WorldEntity[], registry: RegistryContract,
    viewport: { centerX: number; centerY: number; gridCellPixelSize: number }, width: number, height: number,
    version: string, getTexture: (key: string) => Promise<Texture>): void {
    if (this.signature === version) return;
    this.signature = version;
    this.graphics.clear();
    const centers = new Map(entities.flatMap(entity => {
      const definition = registry.queries.findEntityDefinition(entity.definitionId);
      if (!definition) return [];
      const rect = resolveEntityGridRect({ entity, definition });
      return [[entity.id, { x: width / 2 + (rect.x + rect.width / 2 - viewport.centerX) * viewport.gridCellPixelSize,
        y: height / 2 + (rect.y + rect.height / 2 - viewport.centerY) * viewport.gridCellPixelSize,
        size: Math.min(rect.width, rect.height) * viewport.gridCellPixelSize }]] as const;
    }));
    for (const link of overlay?.links ?? []) {
      const a = centers.get(link.sourceEntityId), b = centers.get(link.targetEntityId);
      if (!a || !b) continue;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (!length) continue;
      for (let at = 0; at < length; at += link.binding ? length : 12) {
        const end = Math.min(length, at + (link.binding ? length : 7));
        this.graphics.moveTo(a.x + (b.x - a.x) * at / length, a.y + (b.y - a.y) * at / length)
          .lineTo(a.x + (b.x - a.x) * end / length, a.y + (b.y - a.y) * end / length);
      }
      const selected = overlay?.selectedEntityIds.some(id => id === link.sourceEntityId || id === link.targetEntityId);
      const stroke = { color: link.binding ? 0x2084b5 : 0x657a8c, width: selected ? 3 : 2, alpha: selected ? 1 : .65 };
      this.graphics.stroke(stroke);
      const dx = (b.x - a.x) / length, dy = (b.y - a.y) / length;
      const tip = { x: a.x + (b.x - a.x) * .65, y: a.y + (b.y - a.y) * .65 };
      this.graphics.moveTo(tip.x - dx * 8 + dy * 4, tip.y - dy * 8 - dx * 4)
        .lineTo(tip.x, tip.y).lineTo(tip.x - dx * 8 - dy * 4, tip.y - dy * 8 + dx * 4).stroke(stroke);
    }
    const active = new Set<string>();
    for (const [id, items] of Object.entries(overlay?.productionItemIds ?? {})) {
      const center = centers.get(id);
      if (!center) continue;
      const size = Math.min(28, Math.max(12, center.size * .42));
      for (const [index, item] of items.entries()) {
        const key = JSON.stringify([id, item]); active.add(key);
        let icon = this.icons.get(key);
        if (!icon) {
          icon = this.container.addChild(new Sprite()); icon.anchor.set(.5); this.icons.set(key, icon);
          const target = icon;
          void getTexture(`item-icon-${registry.queries.findItemDefinition(item)?.iconId ?? item}`).then(texture => {
            if (!this.disposed && this.icons.get(key) === target) target.texture = texture;
          }).catch(() => {});
        }
        icon.width = size; icon.height = size;
        icon.position.set(center.x + (index - (items.length - 1) / 2) * size, center.y);
      }
    }
    for (const [key, icon] of this.icons) if (!active.has(key)) { icon.destroy(); this.icons.delete(key); }
  }

  destroy(): void { this.disposed = true; this.icons.clear(); this.container.destroy({ children: true }); }
}
