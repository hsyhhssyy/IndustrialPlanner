import { Container, Geometry, GlProgram, Mesh, Shader, Sprite, Texture, UniformGroup } from 'pixi.js';
import type { LogisticsBakedManifest, LogisticsPipeRoute } from '@/shared/logistics-baked';
import { fluidColorToNumber, resolveFluidColor, type FluidColorRole } from '@/shared/fluid-color';
import type { LogisticsDynamicAssets, LogisticsDynamicSession } from '../texture';
import { createLogisticsFlowGeometry, createLogisticsFlowIndices, resolveLogisticsEndpoint } from './logistics-baked-geometry';

interface RouteView {
  route: LogisticsPipeRoute;
  mesh: Mesh<Geometry, Shader>;
  uniforms: UniformGroup;
  back: Container;
  endpoints: Container;
  sprites: { id: string; sprite: Container }[];
  occupied: ReadonlySet<string> | null;
  exact: boolean;
  visibilityVersion: string;
  fluidId: string | null;
}

/** 后支架→整路线流体→现有管壳层→端帽；所有路线共享烘焙数据及编译后的程序。 */
export class LogisticsBakedFlowScene {
  public readonly container = new Container();
  public readonly endpoints = new Container();
  private readonly back = new Container();
  public readonly fluid = new Container();
  private readonly routes = new Map<string, RouteView>();
  private session: LogisticsDynamicSession | null = null;
  private assets: LogisticsDynamicAssets | null = null;
  private destroyed = false;

  public constructor() {
    this.container.label = 'logistics-baked-routes'; this.fluid.label = 'logistics-material-flow';
    this.endpoints.label = 'logistics-route-endpoints'; this.container.addChild(this.back, this.fluid);
  }

  public get timing(): LogisticsBakedManifest['cycle'] | null { return this.assets?.manifest.cycle ?? null; }

  public sync(options: {
    enabled: boolean;
    acquire: () => LogisticsDynamicSession;
    routes: ReadonlyMap<string, LogisticsPipeRoute>;
    visibility: ReadonlyMap<string, boolean>;
    hidden: ReadonlySet<string>;
    version: string;
    view: { x: number; y: number; centerX: number; centerY: number; scale: number; rotation: number };
  }): void {
    this.container.visible = this.endpoints.visible = options.enabled;
    for (const root of [this.container, this.endpoints]) {
      root.position.set(options.view.x, options.view.y); root.pivot.set(options.view.centerX, options.view.centerY);
      root.scale.set(options.view.scale); root.rotation = options.view.rotation;
    }
    for (const [id, view] of this.routes) if (options.routes.get(id) !== view.route) {
      this.destroyRoute(view); this.routes.delete(id);
    }
    if (!options.enabled) return;
    if (!this.session) {
      const session = options.acquire(); this.session = session;
      void session.ready.then((assets) => { if (!this.destroyed) this.assets = assets; }).catch((error: unknown) => {
        if (!this.destroyed) console.error('[LogisticsBaked] Route assets unavailable', error);
      });
    }
    if (!this.assets) return;
    for (const [id, route] of options.routes) {
      let view = this.routes.get(id);
      if (!view) { view = this.createRoute(route, this.assets); this.routes.set(id, view); }
      const visible = (entityId: string) => options.visibility.get(entityId) === true && !options.hidden.has(entityId);
      if (view.visibilityVersion !== options.version || view.occupied !== route.occupied || view.exact !== route.exact) {
        const indices = createLogisticsFlowIndices(route.segments, (entityId) => visible(entityId) && (!route.exact || route.occupied.has(entityId)));
        // AI-REMOVED 2026-09-14:
        // Reason: setDataWithSize 的实际实现将 size 再乘元素字节数，传 byteLength 会使 GPU 更新越界。
        // Trigger: 精确模式的真实截图仍连续填充前几格，没有保留占用空洞。
        // Evidence: Pixi Buffer.mjs 的 _updateSize = size * value.BYTES_PER_ELEMENT；CPU 索引正确但 GPU 沿用旧值。
        // Replacement: 下方 Buffer.data 标准赋值，由 Pixi 自行传入元素数量并更新 GPU。
        // Risk: Low；通过真实 GPU 索引回读及三个 Screen Profile 验证。
        // Human Review: Required
        // Original code:
        // view.mesh.geometry.indexBuffer.setDataWithSize(indices, indices.byteLength, true);
        // view.mesh.geometry.indexBuffer.update();
        view.mesh.geometry.indexBuffer.data = indices;
        for (const item of view.sprites) item.sprite.visible = visible(item.id);
        view.occupied = route.occupied; view.exact = route.exact; view.visibilityVersion = options.version;
      }
      const playback = route.playback;
      view.mesh.visible = playback.itemId !== null && playback.thickness > 0;
      const u = view.uniforms.uniforms;
      u.uTime = route.seconds;
      u.uThickness = route.exact ? 1 : playback.thickness;
      const hasHead = !route.exact && playback.head < route.segments.length && (playback.phase === 'head' || playback.phase === 'draining');
      const bounds = u.uBounds as Float32Array;
      bounds[0] = 4;
      bounds[1] = hasHead ? 5 + playback.head : 6 + route.segments.length;
      bounds[2] = this.assets.manifest.cycle.edgeWidth;
      bounds[3] = hasHead ? Math.min(1, playback.head * 2, (route.segments.length - playback.head) * 2) : 0;
      if (view.fluidId !== playback.itemId) {
        view.fluidId = playback.itemId;
        u.uGas = route.gas ? 1 : 0;
        for (const [uniform, role] of [['uBody', 'body'], ['uSkin', 'skin'], ['uSkin2', 'skin2'], ['uFoam', 'splash']] as const) {
          const value = fluidColorToNumber(resolveFluidColor(route.fluidColors, role as FluidColorRole));
          (u[uniform] as Float32Array).set([(value >> 16 & 255) / 255, (value >> 8 & 255) / 255, (value & 255) / 255, 1]);
        }
      }
      view.uniforms.update();
    }
  }

  private createRoute(route: LogisticsPipeRoute, assets: LogisticsDynamicAssets): RouteView {
    const data = createLogisticsFlowGeometry(route.segments);
    const geometry = new Geometry({ attributes: {
      aPosition: { buffer: data.positions, format: 'float32x2' }, aUV: { buffer: data.uvs, format: 'float32x2' },
      aStart: { buffer: data.starts, format: 'float32' }, aShape: { buffer: data.shapes, format: 'float32' },
    }, indexBuffer: createLogisticsFlowIndices(route.segments, () => true) });
    const rgba = () => new Float32Array([1, 1, 1, 1]);
    const uniforms = new UniformGroup({
      uTime: { value: 0, type: 'f32' }, uThickness: { value: 0, type: 'f32' }, uGas: { value: 0, type: 'f32' },
      uResolution: { value: assets.manifest.resolution, type: 'f32' },
      uBounds: { value: new Float32Array([4, 5, .012, 0]), type: 'vec4<f32>' },
      uBody: { value: rgba(), type: 'vec4<f32>' }, uSkin: { value: rgba(), type: 'vec4<f32>' },
      uSkin2: { value: rgba(), type: 'vec4<f32>' }, uFoam: { value: rgba(), type: 'vec4<f32>' },
    });
    const source = assets.manifest.fluidPlayback.referenceShader;
    // 数值 mapping 必须取目标纹理的像素中心，不能线性插值 RG16；其他场仍使用双线性采样。
    const fragment = source.fragment.replace('uniform sampler2D uData;', 'uniform float uResolution;\nuniform sampler2D uData;')
      .replace('vec4 fm=tile(0.,mapUV);', 'vec4 fm=texture(uData,(floor((vec2(2.+vShape*132.,2.)+mapUV*128.)*uResolution)+.5)/(1024.*uResolution));');
    if (fragment === source.fragment || !fragment.includes('floor((vec2(2.+vShape*132.')) throw new Error('Unsupported baked mapping shader');
    const texture = (key: string): Texture => {
      const result = assets.textures.get(key); if (!result) throw new Error(`Missing baked texture: ${key}`); return result;
    };
    const shader = new Shader({ glProgram: GlProgram.from({ name: 'logistics-baked-flow',
      vertex: `#version 300 es\n${source.vertex}`, fragment: `#version 300 es\n${fragment}` }),
    resources: { flow: uniforms, uData: texture('fluid-data').source, uFog: texture('gas-field').source } });
    const mesh = new Mesh({ geometry, shader }); mesh.label = 'logistics-material-flow';
    this.fluid.addChild(mesh);
    const back = new Container(), endpoints = new Container();
    this.back.addChild(back); this.endpoints.addChild(endpoints);
    const sprites: RouteView['sprites'] = [];
    for (const segment of route.segments) if (segment.support) {
      const sprite = new Sprite(texture(`static/pipe.${segment.shape}.support-back`));
      sprite.anchor.set(.5); sprite.position.set(segment.x, segment.y); sprite.rotation = segment.rotation * Math.PI / 180;
      sprite.scale.set(1 / assets.manifest.pixelsPerCell); back.addChild(sprite); sprites.push({ id: segment.id, sprite });
    }
    if (!route.closed) for (const end of ['entry', 'exit'] as const) {
      const segment = end === 'entry' ? route.segments[0]! : route.segments[route.segments.length - 1]!;
      const point = resolveLogisticsEndpoint(segment, end);
      const holder = new Container(); holder.position.set(point.x, point.y); holder.rotation = point.rotation;
      for (const key of [assets.manifest.endpointConnector.whitening, assets.manifest.endpointConnector.composite]) {
        const sprite = new Sprite(texture(`static/${key}`)); sprite.anchor.set(.5); sprite.scale.set(1 / assets.manifest.pixelsPerCell); holder.addChild(sprite);
      }
      endpoints.addChild(holder); sprites.push({ id: segment.id, sprite: holder });
    }
    return { route, mesh, uniforms, back, endpoints, sprites, occupied: null, exact: false, visibilityVersion: '', fluidId: null };
  }

  private destroyRoute(view: RouteView): void {
    view.mesh.geometry.destroy(); view.mesh.shader?.destroy(); view.mesh.destroy();
    view.back.destroy({ children: true }); view.endpoints.destroy({ children: true });
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const view of this.routes.values()) this.destroyRoute(view);
    this.routes.clear(); this.session?.release(); this.container.destroy({ children: true }); this.endpoints.destroy({ children: true });
  }
}

// AI-REMOVED 2026-09-14:
// Reason: baked manifest 不再复制流体配色，也不再回退到 Registry tag 单色。
// Trigger: 用户要求 ItemDefinition.fluidColors 成为唯一运行时颜色来源。
// Evidence: 路线状态已经携带当前物品定义的 fluidColors 引用。
// Replacement: sync 中的 route.fluidColors + shared/fluid-color.ts。
// Risk: Low
// Human Review: Required
// Original code:
// const profile = playback.itemId === null ? undefined : this.assets.manifest.fluidProfiles[playback.itemId];
// u.uGas = (profile ? profile.phase === 'gas' : route.gas) ? 1 : 0;
// for (const [uniform, role] of [['uBody', 'body'], ['uSkin', 'skin'], ['uSkin2', 'skin2'], ['uFoam', 'splash']] as const) {
//   // 未提供多层配色的物品沿用 Registry 单色，不凭空推断游戏颜色。
//   const hex = profile?.colors[role] ?? profile?.colors.skin ?? route.color;
//   const value = Number.parseInt(hex.replace('#', ''), 16);
//   (u[uniform] as Float32Array).set([(value >> 16 & 255) / 255, (value >> 8 & 255) / 255, (value & 255) / 255, 1]);
// }
