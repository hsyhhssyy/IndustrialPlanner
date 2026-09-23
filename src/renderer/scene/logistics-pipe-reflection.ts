import { Container, Filter, GlProgram, RenderTexture, Sprite, UniformGroup, type Renderer } from 'pixi.js';
import type { LogisticsDynamicAssets } from '../texture';
import type { LogisticsPipeRoute } from '@/shared/logistics-baked';
import type { LogisticsMaterialEffect } from '@/shared/logistics-material';

/** 场景只合成一次；关闭时销毁专用离屏纹理，不启用全局 back buffer。 */
export class LogisticsPipeReflectionScene {
  public readonly scene = new Container();
  private readonly optics = new Container();
  private readonly sprites = new Map<string, Sprite>();
  private target: RenderTexture | null = null;
  private filter: Filter | null = null;
  private uniforms: UniformGroup | null = null;
  private layers: { stage: Container; lower: Container[]; pipes: Container; underPipe: Container[] } | null = null;

  public configure(layers: { stage: Container; lower: Container[]; pipes: Container; underPipe: Container[] }): void {
    this.layers = layers;
  }

  public sync(options: {
    enabled: boolean; assets: LogisticsDynamicAssets | null; routes: ReadonlyMap<string, LogisticsPipeRoute>;
    visible: (id: string) => boolean; effects?: ReadonlyMap<string, LogisticsMaterialEffect>;
    width: number; height: number; resolution: number;
    view: { x: number; y: number; centerX: number; centerY: number; scale: number; rotation: number };
  }): void {
    const contract = options.assets?.manifest.sceneTransmission;
    if (!options.enabled || !contract || !options.assets) { this.release(); return; }
    if (!this.target) {
      if (this.layers) {
        this.scene.addChild(...this.layers.lower, ...this.layers.underPipe);
        this.layers.stage.addChildAt(this.scene, 0);
      }
      this.target = RenderTexture.create({ width: options.width, height: options.height, resolution: options.resolution });
      this.uniforms = new UniformGroup({
        uSceneSize: { value: new Float32Array([options.width, options.height]), type: 'vec2<f32>' },
        uGlassTint: { value: new Float32Array(contract.glassLinearRGB), type: 'vec3<f32>' },
        uReflectionScale: { value: contract.reflectionEncodingScale, type: 'f32' },
      });
      this.filter = new Filter({ glProgram: GlProgram.from({ name: 'pipe-wall-reflection',
        vertex: `in vec2 aPosition; out vec2 vTextureCoord; out vec2 vSceneUV;
          uniform vec4 uInputSize; uniform vec4 uOutputFrame; uniform vec4 uOutputTexture; uniform vec2 uSceneSize;
          void main() {
            vec2 p = aPosition * uOutputFrame.zw + uOutputFrame.xy;
            vSceneUV = p / uSceneSize;
            vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
            gl_Position = vec4(p.x * 2. / uOutputTexture.x - 1., p.y * 2. * uOutputTexture.z / uOutputTexture.y - uOutputTexture.z, 0., 1.);
          }`,
        fragment: `in vec2 vTextureCoord; in vec2 vSceneUV; out vec4 finalColor;
          uniform sampler2D uTexture; uniform sampler2D uOptics; uniform vec3 uGlassTint; uniform float uReflectionScale;
          vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(vec3(.04045), c)); }
          vec3 toDisplay(vec3 c) { c = max(c, vec3(0.)); return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(vec3(.0031308), c)); }
          void main() {
            vec4 scene = texture(uTexture, vTextureCoord), optics = texture(uOptics, vSceneUV);
            vec3 radiance = optics.rgb / max(optics.a, .00001) / uReflectionScale;
            vec3 color = toDisplay(toLinear(scene.rgb / max(scene.a, .00001)) * uGlassTint + radiance);
            finalColor = vec4(mix(scene.rgb, color * scene.a, optics.a), scene.a);
          }` }), resolution: options.resolution,
        resources: { opticsUniforms: this.uniforms, uOptics: this.target.source } });
      this.scene.filters = [this.filter];
    }
    this.target.resize(options.width, options.height, options.resolution);
    this.filter!.resolution = options.resolution;
    (this.uniforms!.uniforms.uSceneSize as Float32Array).set([options.width, options.height]);
    this.uniforms!.update();
    const { view } = options;
    this.optics.position.set(view.x, view.y); this.optics.pivot.set(view.centerX, view.centerY);
    this.optics.scale.set(view.scale); this.optics.rotation = view.rotation;
    const active = new Set<string>();
    for (const route of options.routes.values()) for (const segment of route.segments) {
      if (!options.visible(segment.id) || options.effects?.has(segment.id)) continue;
      active.add(segment.id);
      let sprite = this.sprites.get(segment.id);
      if (!sprite) { sprite = new Sprite(); sprite.anchor.set(.5); this.optics.addChild(sprite); this.sprites.set(segment.id, sprite); }
      sprite.texture = options.assets.textures.get(`static/pipe.${segment.shape}.optical-reflection`)!;
      sprite.position.set(segment.x, segment.y); sprite.rotation = segment.rotation * Math.PI / 180;
      sprite.scale.set(1 / options.assets.manifest.pixelsPerCell);
    }
    for (const [id, sprite] of this.sprites) if (!active.has(id)) { sprite.destroy(); this.sprites.delete(id); }
  }

  public render(renderer: Renderer): void {
    if (this.target) renderer.render({ container: this.optics, target: this.target, clear: true });
  }

  private release(): void {
    if (!this.target) return;
    if (this.layers) {
      this.scene.removeFromParent();
      this.layers.lower.forEach((layer, index) => this.layers!.stage.addChildAt(layer, index));
      this.layers.underPipe.forEach((layer, index) => this.layers!.pipes.addChildAt(layer, index));
    }
    this.scene.filters = null;
    this.filter?.destroy(); this.filter = null;
    this.target?.destroy(true); this.target = null; this.uniforms = null;
    for (const sprite of this.sprites.values()) sprite.destroy();
    this.sprites.clear();
  }

  public destroy(): void { this.release(); this.optics.destroy({ children: true }); }
}
