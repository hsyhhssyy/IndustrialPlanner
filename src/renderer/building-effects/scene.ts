import { Container } from 'pixi.js';
import type { WorldEntity } from '@/domain/document/world-document';
import type { EntityDefinition } from '@/domain/registry/types/entity-definition';
import type { LogisticsMaterialFrameState } from '@/shared/logistics-material';
import type { EffectPlacement, WorldBounds } from './types';
import { BuildingEffectAssets } from './assets';
import { BuildingEffectBatch } from './batch';
import { SceneHeightCache } from './height-cache';
import { fieldBounds, tileKeys } from './height-field';
import { resolveBuildingEffectScene, resolveEffectFrame, type EffectScene } from './placements';

export class BuildingEffectsScene {
  public readonly container = new Container({ label: 'building-height-effects', eventMode: 'none' });
  public readonly portKeys = new Set<string>();
  private assets: BuildingEffectAssets | null = null;
  private readonly height = new SceneHeightCache();
  private scene: EffectScene = { surfaces: [], effects: [], portKeys: new Map(), issues: [] };
  private version = '';
  private batches = new Map<string, { batch: BuildingEffectBatch; resourceId: string }>();
  private batchSignature = '';
  private readonly reported = new Set<string>();
  private readonly frames = new Map<string, number>();
  private syncSignature = '';

  public sync(options: {
    view: { x: number; y: number; centerX: number; centerY: number; scale: number; rotation: number };
    enabled: boolean; version: string; nowMs: number; bounds: WorldBounds;
    entities: readonly WorldEntity[]; definitions: ReadonlyMap<string, EntityDefinition>;
    materials?: LogisticsMaterialFrameState; hiddenIds?: ReadonlySet<string>;
    ringStatus?: ReadonlyMap<string, number>; activatedIds?: ReadonlySet<string>;
  }): void {
    this.container.visible = options.enabled;
    if (!options.enabled) { this.release(); return; }
    this.assets ??= new BuildingEffectAssets();
    const assets = this.assets, manifest = assets.manifest;
    if (!manifest) return;
    this.container.position.set(options.view.x, options.view.y);
    this.container.pivot.set(options.view.centerX, options.view.centerY);
    this.container.scale.set(options.view.scale);
    this.container.rotation = options.view.rotation;
    const version = options.version;
    if (this.version !== version) {
      this.scene = resolveBuildingEffectScene({ ...options, manifest });
      this.height.sync(this.scene.surfaces);
      this.version = version;
      for (const issue of this.scene.issues) if (!this.reported.has(issue)) {
        this.reported.add(issue); console.warn('[building-port-effects]', issue);
      }
    }
    const nextFrames = new Map<string, number>();
    for (const effect of this.scene.effects) {
      if (!nextFrames.has(effect.resourceId)) nextFrames.set(effect.resourceId,
        resolveEffectFrame(manifest.effects[effect.resourceId]!, options.nowMs));
    }
    const syncSignature = `${version}:${assets.revision}:${JSON.stringify(options.bounds)}:${[...nextFrames].map(([id, frame]) => `${id}:${frame}`).join('|')}`;
    if (syncSignature === this.syncSignature) return;
    this.syncSignature = syncSignature;
    const groups = new Map<string, { placements: EffectPlacement[]; tile: string; resourceId: string; page: number }>();
    const retainedHeights = new Set<string>(), retainedColors = new Set<string>(), retainedTiles = new Set<string>();
    this.frames.clear(); this.portKeys.clear();
    const visible = this.scene.effects.filter((effect) => {
      const field = manifest.effects[effect.resourceId]!.height;
      const b = fieldBounds({ ...effect, field });
      return b.right > options.bounds.left && b.left < options.bounds.right && b.bottom > options.bounds.top && b.top < options.bounds.bottom;
    }).sort((a, b) => Number(a.ring) - Number(b.ring));
    for (const effect of visible) {
      const resource = manifest.effects[effect.resourceId]!;
      if (!this.frames.has(effect.resourceId)) this.frames.set(effect.resourceId, nextFrames.get(effect.resourceId)!);
      const frame = resource.frames[this.frames.get(effect.resourceId)!]!;
      const page = resource.pages[frame.page]!;
      retainedHeights.add(resource.height.file); retainedColors.add(page.file);
      const template = assets.template(resource.height), color = assets.color(page.file);
      let ready = Boolean(template && color);
      for (const tile of tileKeys(fieldBounds({ ...effect, field: resource.height }))) {
        retainedTiles.add(tile);
        const scene = this.height.get(tile, assets, retainedHeights);
        if (!template || !color || !scene) { ready = false; continue; }
        const key = `${effect.ring}:${effect.resourceId}:${frame.page}:${tile}`;
        let group = groups.get(key);
        if (!group) { group = { placements: [], tile, resourceId: effect.resourceId, page: frame.page }; groups.set(key, group); }
        group.placements.push(effect);
      }
      const portKey = this.scene.portKeys.get(effect.id);
      if (ready && portKey) this.portKeys.add(portKey);
    }
    const signature = `${version}:${assets.revision}:${[...groups].map(([key, group]) => `${key}:${group.placements.map((p) => p.id).join(',')}`).join('|')}`;
    if (signature !== this.batchSignature) {
      this.clearBatches();
      for (const [key, group] of groups) {
        const resource = manifest.effects[group.resourceId]!;
        const batch = new BuildingEffectBatch(this.container, group.placements, resource, group.tile,
          this.height.get(group.tile, assets, retainedHeights)!, assets.template(resource.height)!,
          assets.color(resource.pages[group.page]!.file)!, group.page, manifest.heightMin, manifest.heightMax);
        this.batches.set(key, { batch, resourceId: group.resourceId });
      }
      this.batchSignature = signature;
    }
    for (const { batch, resourceId } of this.batches.values()) batch.frame(this.frames.get(resourceId)!);
    this.height.retain(retainedTiles);
    assets.retain(retainedHeights, retainedColors);
  }

  public destroy(): void { this.release(); this.container.destroy({ children: true }); }

  private clearBatches(): void {
    for (const { batch } of this.batches.values()) batch.destroy();
    this.batches.clear();
  }

  private release(): void {
    this.clearBatches(); this.height.destroy(); this.assets?.destroy(); this.assets = null;
    this.version = ''; this.batchSignature = ''; this.syncSignature = ''; this.portKeys.clear();
  }
}
