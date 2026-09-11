import { Container, Geometry, GlProgram, Mesh, Shader, Texture, UniformGroup } from 'pixi.js';
import type { BuildingEffectResource, EffectPlacement } from './types';
import { HEIGHT_TILE_CELLS, rotatePoint } from './height-field';

const vertex = `#version 300 es
precision highp float;
in vec2 aPosition; in vec2 aUV; in vec2 aHeightUV; in vec2 aHeight;
uniform mat3 uProjectionMatrix; uniform mat3 uWorldTransformMatrix; uniform mat3 uTransformMatrix;
out vec2 vUV; out vec2 vHeightUV; out vec2 vHeight; out vec2 vWorld;
void main(){vUV=aUV;vHeightUV=aHeightUV;vHeight=aHeight;vWorld=aPosition;
vec3 p=uProjectionMatrix*uWorldTransformMatrix*uTransformMatrix*vec3(aPosition,1.);
gl_Position=vec4(p.xy,0.,1.);}`;
const fragment = `#version 300 es
precision highp float;
in vec2 vUV; in vec2 vHeightUV; in vec2 vHeight; in vec2 vWorld;
uniform sampler2D uColorTexture; uniform sampler2D uHeight; uniform sampler2D uScene;
uniform vec4 uRanges; uniform vec2 uTile;
uniform vec4 uColorBounds;
uniform vec4 uColor;
out vec4 finalColor;
float q(vec2 rg){vec2 bytes=floor(rg*255.+.5);return (bytes.x*256.+bytes.y)/65535.;}
void main(){
vec2 sceneUV=(vWorld-uTile)/${HEIGHT_TILE_CELLS}.;
if(any(lessThan(sceneUV,vec2(0.)))||any(greaterThanEqual(sceneUV,vec2(1.)))) discard;
vec4 height=texture(uHeight,vHeightUV); if(height.a<.5) discard;
vec4 scene=texture(uScene,sceneUV);
float effectY=mix(uRanges.z,uRanges.w,q(height.rg))+vHeight.x;
float sceneY=mix(uRanges.x,uRanges.y,q(scene.rg));
float epsilon=max(vHeight.y,((uRanges.y-uRanges.x)+(uRanges.w-uRanges.z))/65535.);
if(scene.a>.5 && effectY+epsilon<sceneY) discard;
finalColor=texture(uColorTexture,clamp(vUV,uColorBounds.xy,uColorBounds.zw))*uColor;
}`;

/** 同一资源页、区域和阶段共用一次绘制；实例高度作为顶点属性传入。 */
export class BuildingEffectBatch {
  public readonly mesh: Mesh<Geometry, Shader>;
  private readonly uniforms: UniformGroup;
  private readonly uvs: Float32Array;
  private lastFrame = -1;

  public constructor(parent: Container, placements: readonly EffectPlacement[], private readonly resource: BuildingEffectResource,
    tile: string, scene: Texture, height: Texture, color: Texture, page: number, min: number, max: number) {
    const positions = new Float32Array(placements.length * 8);
    this.uvs = new Float32Array(placements.length * 8);
    const heightUVs = new Float32Array(placements.length * 8);
    const heights = new Float32Array(placements.length * 8);
    const indices = new Uint32Array(placements.length * 6);
    const field = resource.height;
    placements.forEach((placement, i) => {
      [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([u, v], j) => {
        const [x, y] = rotatePoint((u! * field.width - field.pivot[0]) / field.pixelsPerCell + field.center[0],
          (v! * field.height - field.pivot[1]) / field.pixelsPerCell + field.center[1], placement.rotation);
        const offset = i * 8 + j * 2;
        positions.set([placement.x + x, placement.y + y], offset);
        heightUVs.set([u!, v!], offset);
        heights.set([placement.baseY, placement.epsilon], offset);
      });
      indices.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    });
    const [tx, ty] = tile.split(',').map(Number);
    this.uniforms = new UniformGroup({
      uRanges: { value: new Float32Array([min, max, field.min, field.max]), type: 'vec4<f32>' },
      uTile: { value: new Float32Array([tx! * HEIGHT_TILE_CELLS, ty! * HEIGHT_TILE_CELLS]), type: 'vec2<f32>' },
      uColorBounds: { value: new Float32Array(4), type: 'vec4<f32>' },
    });
    const geometry = new Geometry({ attributes: {
      aPosition: { buffer: positions, format: 'float32x2' }, aUV: { buffer: this.uvs, format: 'float32x2' },
      aHeightUV: { buffer: heightUVs, format: 'float32x2' }, aHeight: { buffer: heights, format: 'float32x2' },
    }, indexBuffer: indices });
    this.mesh = new Mesh({ geometry, texture: Texture.WHITE,
      shader: new Shader({ glProgram: GlProgram.from({ name: 'building-height-effects', vertex, fragment }),
        resources: { effectUniforms: this.uniforms, uScene: scene.source, uHeight: height.source, uColorTexture: color.source } }) });
    this.mesh.label = `building-effect-batch:${tile}:${page}`;
    this.mesh.eventMode = 'none';
    parent.addChild(this.mesh);
  }

  public frame(index: number): void {
    if (index === this.lastFrame) return;
    this.lastFrame = index;
    const f = this.resource.frames[index]!, p = this.resource.pages[f.page]!;
    const uv = [f.x / p.width, f.y / p.height, (f.x + f.width) / p.width, f.y / p.height,
      (f.x + f.width) / p.width, (f.y + f.height) / p.height, f.x / p.width, (f.y + f.height) / p.height];
    for (let i = 0; i < this.uvs.length; i += 8) this.uvs.set(uv, i);
    this.mesh.geometry.getBuffer('aUV').update();
    (this.uniforms.uniforms.uColorBounds as Float32Array).set([(f.x + .5) / p.width, (f.y + .5) / p.height,
      (f.x + f.width - .5) / p.width, (f.y + f.height - .5) / p.height]);
    this.uniforms.update();
  }

  public destroy(): void {
    this.mesh.shader?.destroy(); this.mesh.geometry.destroy(); this.mesh.destroy();
  }
}
