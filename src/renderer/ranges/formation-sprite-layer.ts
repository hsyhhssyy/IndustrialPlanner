import { Container, Sprite, Texture } from "pixi.js";

import type { GridRect } from "@/domain/shared/grid";
import { areGridRectsIntersecting } from "@/shared/geometry/power-range";
import { resolveViewportRectFromWorldGridRect } from "@/shared/geometry/viewport-transform";

import type { RenderResourceScope } from "../texture";
import type { RangeFrameContext } from "./types";

/** 阵列投影的静态外观；white 表示未选择相位或布局非法。 */
export type FormationSpriteVisual = "ming" | "hui" | "heng" | "white";

export interface FormationSpriteInstance {
  readonly key: string;
  readonly gridRect: GridRect;
  readonly visual: FormationSpriteVisual;
}

const SPRITE_ID_BY_VISUAL: Readonly<Record<FormationSpriteVisual, string>> = {
  ming: "magic_spawner_range_ming",
  hui: "magic_spawner_range_hui",
  heng: "magic_spawner_range_heng",
  white: "magic_spawner_range_white",
};

const FORMATION_VISUALS: readonly FormationSpriteVisual[] = ["ming", "hui", "heng", "white"];

interface FormationSpriteEntry {
  readonly sprite: Sprite;
}

interface FormationTextureSource {
  getTexture(key: string, requirement?: "required" | "optional"): Promise<Texture>;
}

/**
 * 明晦炉 / 分影明晦炉阵列区域的静态投影。
 *
 * 2026-11-25：只做区域静态外观，不接等阶角标与流光；未选择相位或布局非法时使用白色。
 * 贴图与来源见 resources/formation-sprite-sources.json，运行时只读 public/3d-top-view/sprites。
 */
export class FormationSpriteLayer {
  readonly container = new Container();
  private readonly entries = new Map<string, FormationSpriteEntry>();
  private readonly textures = new Map<FormationSpriteVisual, Texture | null>();
  private readonly initializedTextures = new WeakSet<Texture>();

  constructor(textureManager: FormationTextureSource, resources: RenderResourceScope) {
    this.container.label = "formation-projections";
    for (const visual of FORMATION_VISUALS) {
      this.textures.set(visual, null);
      const loading = textureManager
        .getTexture(`device-sprite-${SPRITE_ID_BY_VISUAL[visual]}`, "optional")
        .then((texture) => {
          this.textures.set(visual, texture);
        })
        .catch(() => {
          this.textures.set(visual, null);
        });
      resources.track(loading);
    }
  }

  sync(ctx: RangeFrameContext, instances: readonly FormationSpriteInstance[]): void {
    const retained = new Set<string>();
    for (const instance of instances) {
      if (!areGridRectsIntersecting(instance.gridRect, ctx.visibleGridRect)) continue;
      const rect = resolveViewportRectFromWorldGridRect({ ...ctx, gridRect: instance.gridRect });
      if (rect === null) continue;
      const texture = this.textures.get(instance.visual) ?? null;
      const entry = this.ensureEntry(instance.key);
      retained.add(instance.key);
      if (texture === null) {
        entry.sprite.visible = false;
        continue;
      }
      if (!this.initializedTextures.has(texture)) {
        this.initializedTextures.add(texture);
        ctx.initializeTexture(texture);
      }
      entry.sprite.texture = texture;
      entry.sprite.visible = true;
      entry.sprite.position.set(rect.left + rect.width / 2, rect.top + rect.height / 2);
      entry.sprite.width = rect.width;
      entry.sprite.height = rect.height;
    }
    for (const [key, entry] of this.entries) {
      if (retained.has(key)) continue;
      entry.sprite.visible = false;
    }
  }

  destroy(): void {
    for (const entry of this.entries.values()) entry.sprite.destroy();
    this.entries.clear();
    this.container.destroy();
  }

  private ensureEntry(key: string): FormationSpriteEntry {
    const existing = this.entries.get(key);
    if (existing !== undefined) return existing;
    const sprite = new Sprite(Texture.EMPTY);
    sprite.anchor.set(0.5);
    sprite.roundPixels = true;
    sprite.visible = false;
    this.container.addChild(sprite);
    const entry: FormationSpriteEntry = { sprite };
    this.entries.set(key, entry);
    return entry;
  }
}
