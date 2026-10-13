import { Container, Geometry, GlProgram, ImageSource, Mesh, Shader, Texture, UniformGroup } from "pixi.js";

import type { RangeAnimationInstance, RangeFrameContext } from "./types";
import { createPublicAssetUrl } from "@/shared/browser/public-asset-url";
import { areGridRectsIntersecting } from "@/shared/geometry/power-range";
import { resolveViewportPointFromWorldPoint, resolveDisplayRotationRadians } from "@/shared/geometry/viewport-transform";

const VERTEX_SHADER = `#version 300 es
precision highp float;
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  vUV = aUV;
  vec3 point = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(aPosition, 1.0);
  gl_Position = vec4(point.xy, 0.0, 1.0);
}`;
const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 finalColor;
uniform sampler2D uAtlas;
uniform vec4 uRect0;
uniform vec4 uRect1;
uniform vec2 uAtlasSize;
uniform float uMix;
uniform vec3 uTint;
vec3 decodeSrgb(vec3 value) {
  return mix(value / 12.92, pow((value + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), value));
}
vec3 encodeSrgb(vec3 value) {
  return mix(value * 12.92, 1.055 * pow(max(value, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055,
    step(vec3(0.0031308), value));
}
vec4 readFrame(vec4 rect) {
  vec2 uv = vec2(fract(vUV.x), clamp(vUV.y, 0.0, 1.0));
  vec4 sampleColor = texture(uAtlas, (rect.xy + uv * rect.zw) / uAtlasSize);
  return vec4(decodeSrgb(sampleColor.rgb) * sampleColor.a, sampleColor.a);
}
void main() {
  vec4 blended = mix(readFrame(uRect0), readFrame(uRect1), uMix);
  vec3 straight = blended.a > 0.00001 ? blended.rgb / blended.a : vec3(0.0);
  finalColor = vec4(encodeSrgb(straight * uTint) * blended.a, blended.a);
}`;

interface RangeManifest {
  readonly schemaVersion: number;
  readonly atlas: { readonly file: string; readonly width: number; readonly height: number };
  readonly playback: {
    readonly frameCount: number;
    readonly fps: number;
    readonly frames: readonly (readonly [number, number, number, number])[];
  };
  readonly mesh: {
    readonly positions: readonly (readonly [number, number])[];
    readonly uvs: readonly (readonly [number, number])[];
    readonly indices: readonly number[];
    readonly bounds: readonly [number, number, number, number];
    // AI-REMOVED 2026-09-27:
    // Reason: 新版美术 Mesh 自身以 13×13 格为边界，运行时不再保存旧素材的人工可见范围。
    // Trigger: 用户要求直接采用美术新版范围并移除范围贴边校准。
    // Evidence: 网站发布 v1.5-20260924-20260927-190710-cst 的 mesh.bounds 为 [-6.5,-6.5,6.5,6.5]。
    // Replacement: 本接口的 bounds。
    // Risk: Low
    // Human Review: Required
    // Original code:
    // readonly visualBounds: readonly [number, number, number, number];
  };
}

// AI-REMOVED 2026-09-27:
// Reason: 旧素材的人工 visualBounds 缩放已无必要，新素材边界直接为 13×13 格。
// Trigger: 用户要求直接采用美术新版尺寸并退役范围贴边测试。
// Evidence: 网站 mesh.json 声明 bounds [-6.5,-6.5,6.5,6.5]、1 Unity unit/cell。
// Replacement: RangeAnimation.sync 中直接使用 manifest.mesh.bounds。
// Risk: Low；运行时仍以当前仿真 gridRect 决定实际屏幕尺寸。
// Human Review: Required
// Original code:
// export function resolveRangeMeshPlacement(
//   layout: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
//   visualBounds: readonly [number, number, number, number],
// ): { readonly x: number; readonly y: number; readonly pivotX: number; readonly pivotY: number;
//   readonly scaleX: number; readonly scaleY: number } {
//   return {
//     x: layout.x + layout.width / 2,
//     y: layout.y + layout.height / 2,
//     pivotX: (visualBounds[0] + visualBounds[2]) / 2,
//     pivotY: (visualBounds[1] + visualBounds[3]) / 2,
//     scaleX: layout.width / (visualBounds[2] - visualBounds[0]),
//     scaleY: layout.height / (visualBounds[3] - visualBounds[1]),
//   };
// }

interface RangeAssets {
  readonly manifest: RangeManifest;
  readonly texture: Texture;
  readonly bitmap: ImageBitmap;
}

interface RangeView {
  readonly mesh: Mesh<Geometry, Shader>;
  readonly uniforms: UniformGroup;
}

/** 一张共享图集由所有工作中的气体散布机复用；停机时不保留任何活跃 Mesh。 */
// AI-CORRECTION 2026-10-13: 播放器接收通用范围实例，资源路径、颜色和方向由调用方提供。
export class RangeAnimation {
  public readonly container = new Container();
  private readonly controller = new AbortController();
  private readonly views = new Map<string, RangeView>();
  private readonly activeSinceMs = new Map<string, number>();
  private loading: Promise<void> | null = null;
  private assets: RangeAssets | null = null;
  private failed = false;
  private destroyed = false;

  public constructor(private readonly assetRoot: string) {
    this.container.label = "gas-environment-animation";
  }

  public get isReady(): boolean {
    return this.assets !== null;
  }

  public prepare(ctx: RangeFrameContext): void {
    if (this.loading !== null || this.assets !== null || this.failed || this.destroyed) return;
    this.loading = this.load(ctx).then((assets) => {
      if (this.destroyed) {
        assets.texture.destroy(true);
        assets.bitmap.close();
        return;
      }
      this.assets = assets;
    }).catch((error: unknown) => {
      if (!this.destroyed) {
        this.failed = true;
        console.error("[Range] Animation unavailable", error);
      }
    });
  }

  public sync(
    ctx: RangeFrameContext,
    ranges: readonly RangeAnimationInstance[],
  ): void {
    if (ranges.length > 0) this.prepare(ctx);
    const activeKeys = new Set(ranges.map((range) => this.rangeKey(range)));
    for (const key of this.activeSinceMs.keys()) {
      if (!activeKeys.has(key)) this.activeSinceMs.delete(key);
    }
    for (const range of ranges) {
      const key = this.rangeKey(range);
      if (!this.activeSinceMs.has(key)) this.activeSinceMs.set(key, ctx.nowMs);
    }

    const assets = this.assets;
    if (assets === null) {
      this.clearViews();
      return;
    }

    const visibleGridRect = ctx.visibleGridRect;
    const visibleKeys = new Set<string>();
    for (const range of ranges) {
      if (!areGridRectsIntersecting(range.gridRect, visibleGridRect)) continue;
      const key = this.rangeKey(range);
      visibleKeys.add(key);
      let view = this.views.get(key);
      if (view === undefined) {
        view = this.createView(range, assets);
        this.views.set(key, view);
      }
      // AI-CORRECTION 2026-09-26：原几何 bounds 含透明衰减区，缩放应按 120 帧可见外沿贴合实际 gridRect。
      // AI-CORRECTION 2026-09-27：美术已把几何边界修正为 13×13 格，直接按新版 bounds 映射当前 gridRect。
      // AI-REMOVED 2026-09-27:
      // Reason: 旧 visualBounds 校准与新版美术边界重复。
      // Trigger: 用户要求直接使用新版 13 格素材。
      // Evidence: 已校验网站 mesh.bounds 为 [-6.5,-6.5,6.5,6.5]。
      // Replacement: 下方按 bounds 设置 position、pivot 和 scale。
      // Risk: Low
      // Human Review: Required
      // Original code:
      // const placement = resolveRangeMeshPlacement(layout, assets.manifest.mesh.visualBounds);
      // view.mesh.position.set(placement.x, placement.y);
      // view.mesh.pivot.set(placement.pivotX, placement.pivotY);
      // view.mesh.scale.set(placement.scaleX, placement.scaleY);
      const placement = resolveRangeAnimationPlacement(ctx, range, assets.manifest.mesh.bounds);
      view.mesh.position.set(placement.x, placement.y);
      view.mesh.pivot.set(placement.pivotX, placement.pivotY);
      view.mesh.scale.set(placement.scaleX, placement.scaleY);
      view.mesh.rotation = placement.rotation;

      const playback = assets.manifest.playback;
      const elapsed = Math.max(0, ctx.nowMs - (this.activeSinceMs.get(key) ?? ctx.nowMs));
      const framePosition = (elapsed * playback.fps / 1000) % playback.frameCount;
      const first = Math.floor(framePosition);
      (view.uniforms.uniforms.uRect0 as Float32Array).set(playback.frames[first]!);
      (view.uniforms.uniforms.uRect1 as Float32Array).set(playback.frames[(first + 1) % playback.frameCount]!);
      view.uniforms.uniforms.uMix = framePosition - first;
      view.uniforms.update();
    }
    for (const [key, view] of this.views) {
      if (!visibleKeys.has(key)) {
        this.destroyView(view);
        this.views.delete(key);
      }
    }
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.controller.abort();
    this.clearViews();
    this.assets?.texture.destroy(true);
    this.assets?.bitmap.close();
    this.container.destroy({ children: true });
  }

  private async load(ctx: RangeFrameContext): Promise<RangeAssets> {
    const fetchAsset = async (file: string): Promise<Response> => {
      const response = await fetch(createPublicAssetUrl(`${this.assetRoot}/${file}`), {
        credentials: "same-origin",
        signal: this.controller.signal,
      });
      if (!response.ok) throw new Error(`Gas environment asset request failed: ${response.status} ${file}`);
      return response;
    };
    const manifest = await (await fetchAsset("manifest.json")).json() as RangeManifest;
    this.validateManifest(manifest);
    const bitmap = await createImageBitmap(await (await fetchAsset(manifest.atlas.file)).blob(), {
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
    });
    if (bitmap.width !== manifest.atlas.width || bitmap.height !== manifest.atlas.height) {
      bitmap.close();
      throw new Error("Gas environment atlas dimensions differ from manifest");
    }
    const texture = new Texture({ source: new ImageSource({
      resource: bitmap,
      alphaMode: "no-premultiply-alpha",
      scaleMode: "linear",
      addressMode: "clamp-to-edge",
      autoGenerateMipmaps: false,
    }) });
    texture.source.label = "gas-environment-flow";
    texture.source.autoGarbageCollect = false;
    try {
      ctx.initializeTexture(texture);
      return { manifest, texture, bitmap };
    } catch (error) {
      texture.destroy(true);
      bitmap.close();
      throw error;
    }
  }

  private validateManifest(manifest: RangeManifest): void {
    const { atlas, playback, mesh } = manifest;
    if (manifest.schemaVersion !== 1 || atlas.file !== "flow-0.webp"
      || !Number.isInteger(atlas.width) || !Number.isInteger(atlas.height)
      || atlas.width <= 0 || atlas.height <= 0
      || !Number.isFinite(playback.fps) || playback.fps <= 0
      || playback.frameCount !== playback.frames.length
      || playback.frameCount <= 0
      || mesh.positions.length !== mesh.uvs.length
      || mesh.positions.length === 0 || mesh.indices.length % 3 !== 0
      || mesh.bounds[2] <= mesh.bounds[0] || mesh.bounds[3] <= mesh.bounds[1]
      // AI-REMOVED 2026-09-27:
      // Reason: 新美术资源不再包含手工 visualBounds。
      // Trigger: 用户要求移除本地范围贴边校准。
      // Evidence: 本地清单直接采用网站 mesh.bounds。
      // Replacement: 上方 bounds 有效性验证。
      // Risk: Low
      // Human Review: Required
      // Original code:
      // || mesh.visualBounds.length !== 4
      // || !mesh.visualBounds.every(Number.isFinite)
      // || mesh.visualBounds[0] < mesh.bounds[0] || mesh.visualBounds[1] < mesh.bounds[1]
      // || mesh.visualBounds[2] > mesh.bounds[2] || mesh.visualBounds[3] > mesh.bounds[3]
      // || mesh.visualBounds[2] <= mesh.visualBounds[0]
      // || mesh.visualBounds[3] <= mesh.visualBounds[1]
      || !mesh.positions.every((point) => point.length === 2 && point.every(Number.isFinite))
      || !mesh.uvs.every((point) => point.length === 2 && point.every(Number.isFinite))
      || !mesh.indices.every((index) => Number.isInteger(index) && index >= 0 && index < mesh.positions.length)
      || !playback.frames.every(([x, y, width, height]) =>
        [x, y, width, height].every(Number.isFinite) && x >= 0 && y >= 0
        && width > 0 && height > 0 && x + width <= atlas.width && y + height <= atlas.height)) {
      throw new Error("Invalid gas environment manifest");
    }
  }

  private createView(
    range: RangeAnimationInstance,
    assets: RangeAssets,
  ): RangeView {
    const { mesh } = assets.manifest;
    const geometry = new Geometry({ attributes: {
      aPosition: { buffer: new Float32Array(mesh.positions.flat()), format: "float32x2" },
      aUV: { buffer: new Float32Array(mesh.uvs.flat()), format: "float32x2" },
    }, indexBuffer: new Uint16Array(mesh.indices) });
    const color = range.color;
    const toLinear = (channel: number): number => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    const uniforms = new UniformGroup({
      uRect0: { value: new Float32Array(4), type: "vec4<f32>" },
      uRect1: { value: new Float32Array(4), type: "vec4<f32>" },
      uAtlasSize: { value: new Float32Array([assets.manifest.atlas.width, assets.manifest.atlas.height]), type: "vec2<f32>" },
      uMix: { value: 0, type: "f32" },
      uTint: { value: new Float32Array([
        toLinear((color >> 16) & 255), toLinear((color >> 8) & 255), toLinear(color & 255),
      ]), type: "vec3<f32>" },
    });
    const shader = new Shader({
      glProgram: GlProgram.from({ name: "gas-environment-animation", vertex: VERTEX_SHADER, fragment: FRAGMENT_SHADER }),
      resources: { gas: uniforms, uAtlas: assets.texture.source },
    });
    const view = new Mesh({ geometry, shader });
    view.label = `range-animation:${range.key}`;
    this.container.addChild(view);
    return { mesh: view, uniforms };
  }

  private clearViews(): void {
    for (const view of this.views.values()) this.destroyView(view);
    this.views.clear();
  }

  private destroyView(view: RangeView): void {
    view.mesh.geometry.destroy();
    view.mesh.shader?.destroy();
    view.mesh.destroy();
  }

  private rangeKey(range: RangeAnimationInstance): string {
    return range.key;
  }
}

/** 世界 AABB 只定位中心，缩放使用设备局部宽高，避免视角旋转重复交换尺寸。 */
export function resolveRangeAnimationPlacement(
  ctx: RangeFrameContext, range: RangeAnimationInstance,
  bounds: readonly [number, number, number, number],
) {
  const center = resolveViewportPointFromWorldPoint({ ...ctx, worldPoint: {
    x: range.gridRect.x + range.gridRect.width / 2,
    y: range.gridRect.y + range.gridRect.height / 2,
  } });
  const swapped = range.rotation === 90 || range.rotation === 270;
  const width = swapped ? range.gridRect.height : range.gridRect.width;
  const height = swapped ? range.gridRect.width : range.gridRect.height;
  return {
    x: center.x, y: center.y,
    pivotX: (bounds[0] + bounds[2]) / 2, pivotY: (bounds[1] + bounds[3]) / 2,
    scaleX: width * ctx.gridCellPixelSize / (bounds[2] - bounds[0]),
    scaleY: height * ctx.gridCellPixelSize / (bounds[3] - bounds[1]),
    rotation: resolveDisplayRotationRadians(ctx.displayRotation) + range.rotation * Math.PI / 180,
  };
}
