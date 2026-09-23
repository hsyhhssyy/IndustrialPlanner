import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { LogisticsMaterialEntityState, LogisticsMaterialFrameState } from '@/shared/logistics-material';
import type { LogisticsDynamicAssets } from '../texture';

/** 管身/支架前层和物流标记使用共享相位图集；流体与支架后层由路线场景统一绘制。 */
export class LogisticsDynamicView {
  public readonly root = new Container();
  private readonly supports: Sprite[] = [];
  private readonly moving: { sprite: Sprite; clip: string; pass: 'arrow' | 'highlight' | 'pattern' | 'chevron' }[] = [];
  private previousState: LogisticsMaterialEntityState | null = null;
  private previousTime = Number.NaN;
  private previousVisual = '';
  private readonly colors: { sprite: Sprite; role: string }[] = [];
  private shell: Sprite | null = null;
  private overlay: Sprite | null = null;
  private readonly head = new Graphics();

  public constructor(private readonly assets: LogisticsDynamicAssets, state: LogisticsMaterialEntityState, private readonly entityId = '') {
    this.root.pivot.set(64, 64);
    const add = (key: string) => {
      const sprite = new Sprite(this.texture(key));
      sprite.anchor.set(.5); sprite.position.set(64, 64);
      sprite.scale.set(128 / assets.manifest.pixelsPerCell);
      this.root.addChild(sprite); return sprite;
    };
    const animated = (pass: 'arrow' | 'highlight' | 'pattern' | 'chevron') => {
      const clip = `${state.kind === 'belt' ? 'conveyor' : 'pipe'}/${state.shape}/${pass}`;
      const frame = assets.manifest.clips[clip]?.frames[0];
      if (!frame) throw new Error(`Missing baked clip: ${clip}`);
      const sprite = add(frame);
      if (pass !== 'pattern') sprite.label = 'logistics-material-flow';
      this.moving.push({ sprite, clip, pass });
      if (state.kind === 'belt') this.colors.push({ sprite, role: pass });
    };
    if (state.kind === 'belt') {
      const layers = assets.manifest.tintableConveyor?.[state.shape];
      if (!layers) throw new Error('Missing tintable conveyor layers');
      for (const role of ['surface', 'edge-glow', 'edge-core']) {
        this.colors.push({ sprite: add(layers.static[role]!), role });
      }
      this.overlay = add(`ui/belt-connectable/${state.shape}`);
      animated('highlight'); animated('arrow');
    } else {
      // 正式管道中支架由路线场景放在反射层之前，虚影没有正式路线。
      if (state.preview) this.supports.push(add(`static/pipe.${state.shape}.support-middle`));
      this.shell = add(`static/pipe.${state.shape}.shell`);
      this.overlay = add(`ui/hover/${state.shape}`);
      // AI-REMOVED 2026-09-20:
      // Reason: 网站 64px 烘焙协议已移除 pipe/straight/pattern，直管标识改为静态 Logo 图层。
      // Trigger: 导入 v1.5-20260919-212522-cst 时新版 clips 不再包含 pattern。
      // Evidence: logistics-baked.json 仅声明三种 pipe/*/chevron，网站 baked.js 也只播放 chevron。
      // Replacement: 下方 marker 对应的 static-logo-glow/static-logo-core。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // if (state.shape === 'straight') animated('pattern');
      animated('chevron');
      if (state.shape === 'straight' && state.marker) {
        add('static/pipe.straight.static-logo-glow');
        add('static/pipe.straight.static-logo-core');
      }
      this.supports.push(add(`static/pipe.${state.shape}.support-front`));
    }
    this.overlay.visible = false;
    this.head.label = 'logistics-preview-head';
    if (state.kind === 'belt') {
      this.head.poly([16, 16, 112, 16, 64, 64]).fill(0xffeb80)
        .poly([112, 16, 112, 112, 64, 64]).fill(0xffe268)
        .poly([112, 112, 16, 112, 64, 64]).fill(0xeac143)
        .poly([16, 112, 16, 16, 64, 64]).fill(0xf6d555);
    } else {
      this.head.poly([52, 26, 76, 26, 76, 65, 97, 65, 64, 100, 31, 65, 52, 65]).fill(0xffffff);
    }
    for (const [x, y, dx, dy] of [[5, 5, 1, 1], [123, 5, -1, 1], [5, 123, 1, -1], [123, 123, -1, -1]]) {
      this.head.moveTo(x! + dx! * 22, y!).lineTo(x!, y!).lineTo(x!, y! + dy! * 22).stroke({ width: 4, color: 0xffdf73 });
    }
    this.head.visible = false;
    this.head.pivot.set(64, 64); this.head.position.set(64, 64);
    this.head.rotation = state.shape === 'straight' ? 0 : state.shape === 'left' ? Math.PI / 2 : -Math.PI / 2;
    this.root.addChild(this.head);
  }

  private texture(key: string): Texture {
    const texture = this.assets.textures.get(key);
    if (!texture) throw new Error(`Missing baked texture: ${key}`);
    return texture;
  }

  public sync(state: LogisticsMaterialEntityState, frame: LogisticsMaterialFrameState): void {
    const time = state.kind === 'belt' || state.preview ? frame.beltSeconds : state.pipeFlow?.seconds ?? 0;
    const effect = frame.effects?.get(this.entityId);
    const reflected = frame.pipeWallReflection === true && !state.preview && !effect;
    const head = state.preview === true && frame.previewHeadId === this.entityId;
    const visual = `${effect}:${reflected}:${head}`;
    if (this.previousState === state && this.previousTime === time && this.previousVisual === visual) return;
    this.previousVisual = visual;
    this.head.visible = head;
    if (this.shell) this.shell.visible = !reflected;
    if (this.overlay) {
      this.overlay.visible = state.kind === 'belt' ? effect === 'connectable' : effect !== undefined;
      if (this.overlay.visible) {
        this.overlay.texture = this.texture(`ui/${state.kind === 'belt' ? 'belt-connectable' : effect === 'invalid' ? 'preview' : effect}/${state.shape}`);
        this.overlay.tint = effect === 'selected' ? 0x67caff : effect === 'invalid' ? 0xff655d
          : effect === 'connectable' || effect === 'hover' ? 0xfff4dc : 0xffffff;
      }
    }
    for (const { sprite, role } of this.colors) {
      const normal = this.assets.manifest.tintableConveyor![state.shape].defaultColors[role]!;
      sprite.tint = effect === 'selected' ? role === 'surface' ? 0x51b8ed : 0xbcf0ff
        : effect === 'preview' ? 0xffffff : effect === 'invalid' ? 0xff655d
        : effect === 'connectable' && role.startsWith('edge') ? 0xfff7e3
        : (Math.round(normal[0] * 255) << 16) | (Math.round(normal[1] * 255) << 8) | Math.round(normal[2] * 255);
    }
    this.previousState = state; this.previousTime = time;
    for (const support of this.supports) support.visible = state.support;
    const id = state.kind === 'pipe' ? 'log_pipe_02_mid' : `grid_belt_01_${state.shape === 'straight' ? 'mid' : state.shape}`;
    const p = this.assets.manifest.parametersByResourceId[id]!;
    const start = state.start + 5;
    const q = start * (2 * p.waterDirection! - 1) - p.flowOffset!;
    for (const { sprite, clip, pass } of this.moving) {
      const phase = pass === 'arrow' ? start - time * p.arrowSpeed!
        : pass === 'highlight' ? (start - time * p.flowSpeed! + p.timeOffset!) * p.flowSpace!
        : pass === 'pattern' ? q * p.staticDensity! : (q + p.flowSpeed! * time) * p.flowDensity!;
      const sequence = this.assets.manifest.clips[clip]!;
      const fraction = phase - Math.floor(phase);
      sprite.texture = this.texture((state.kind === 'belt' ? sequence.tintFrames! : sequence.frames)[Math.round(fraction * sequence.phaseSamples) % sequence.phaseSamples]!);
    }
  }

  public destroy(): void { this.root.destroy({ children: true }); }
}

// AI-REMOVED 2026-09-14:
// Reason: 逐实体实时 Shader 被网站相位图集和每路线共享流体 Mesh 替代。
// Trigger: 用户授权烘焙物流。
// Evidence: 网站 baked-flow.js 的路线批次契约。
// Replacement: 本文件相位 Sprite 与 scene/logistics-baked-flow.ts。
// Risk: 层序和相位需浏览器回归。
// Human Review: Required
// Original code:
// import { Container, GlProgram, Mesh, MeshGeometry, Shader, Sprite, Texture, UniformGroup } from "pixi.js";
// import type { LogisticsMaterialEntityState, LogisticsMaterialFrameState } from "@/shared/logistics-material";
// import type { LogisticsDynamicAssets } from "../texture";
//
// /** 一个实体的材质分层；所有实例复用纹理及编译后的 GlProgram。 */
// export class LogisticsDynamicView {
//   public readonly root = new Container();
//   private readonly supportLayers: Sprite[] = [];
//   private readonly fluidLayers: Container[] = [];
//   private readonly meshes: Mesh<MeshGeometry, Shader>[] = [];
//   private readonly uniforms: UniformGroup[] = [];
//   private fluid: Sprite | null = null;
//   private previousState: LogisticsMaterialEntityState | null = null;
//   private previousTime = Number.NaN;
//
//   public constructor(private readonly assets: LogisticsDynamicAssets, private readonly state: LogisticsMaterialEntityState) {
//     this.root.pivot.set(64, 64);
//     const sprite = (suffix: string) => {
//       const image = new Sprite(this.texture(`static/${state.kind === "belt" ? "conveyor" : "pipe"}.${state.shape}.${suffix}`));
//       // 发布纹理密度可变，分层画布始终使用 128 个逻辑单位。
//       image.width = 128;
//       image.height = 128;
//       this.root.addChild(image);
//       return image;
//     };
//     if (state.kind === "belt") {
//       sprite("base");
//       this.root.addChild(this.createOverlay(0));
//     } else {
//       this.supportLayers.push(sprite("support-back"));
//       this.fluid = sprite("fluid-body");
//       this.fluidLayers.push(this.fluid);
//       const shimmer = this.createOverlay(1);
//       this.root.addChild(shimmer);
//       this.fluidLayers.push(shimmer, sprite("fluid-specular"));
//       this.supportLayers.push(sprite("support-middle"));
//       sprite("shell");
//       this.root.addChild(this.createOverlay(0));
//       this.supportLayers.push(sprite("support-front"));
//     }
//   }
//
//   public sync(state: LogisticsMaterialEntityState, frame: LogisticsMaterialFrameState): void {
//     const time = state.kind === "belt" ? frame.beltSeconds : state.pipeFlow?.seconds ?? 0;
//     if (this.previousState === state && this.previousTime === time) return;
//     this.previousState = state;
//     this.previousTime = time;
//     const filled = state.color !== "empty";
//     for (const sprite of this.supportLayers) sprite.visible = state.support;
//     for (const sprite of this.fluidLayers) sprite.visible = filled;
//     if (this.fluid && filled) this.fluid.tint = Number.parseInt(state.color, 16);
//     for (const group of this.uniforms) {
//       group.uniforms.uStart = state.start;
//       group.uniforms.uFilled = filled ? 1 : 0;
//       group.uniforms.uTime = time;
//       group.update();
//     }
//   }
//
//   public destroy(): void {
//     for (const mesh of this.meshes) {
//       mesh.shader?.destroy();
//       mesh.geometry.destroy();
//     }
//     this.root.destroy({ children: true });
//   }
//
//   private texture(key: string): Texture {
//     const texture = this.assets.textures.get(key);
//     if (!texture) throw new Error(`Missing logistics material texture: ${key}`);
//     return texture;
//   }
//
//   private createOverlay(layer: number): Mesh<MeshGeometry, Shader> {
//     const { manifest } = this.assets;
//     const belt = this.state.kind === "belt";
//     const b = manifest.belt;
//     const p = manifest.pipe;
//     const group = new UniformGroup({
//       uTime: { value: 0, type: "f32" },
//       uStart: { value: this.state.start, type: "f32" },
//       uKind: { value: belt ? 0 : 1, type: "f32" },
//       uCorner: { value: this.state.shape === "straight" ? 0 : 1, type: "f32" },
//       uFilled: { value: 0, type: "f32" },
//       uDirection: { value: p.waterDirection ?? 0, type: "f32" },
//       uLayer: { value: layer, type: "f32" },
//       uAtlasHalfTexel: { value: .5 / manifest.resources["dynamic/conveyor.arrow"]!.width, type: "f32" },
//       // AI-REMOVED 2026-09-13:
//       // Reason: 网站新增物流绘制延后接入，恢复当前正式 WebP 材质读取与 Shader 绑定。
//       // Trigger: 用户要求先导入其他素材，管道及传送带新绘制另行讨论。
//       // Evidence: 正式 logistics-contract2 manifest 使用 WebP，且未声明新 Shader 资源。
//       // Replacement: 当前正式 manifest 的 uColor 和既有材质参数
//       // Risk: Low; Human Review: Required
//       // Original code:
//       // // 新交付 Shader 支持局部填充；当前实体状态表示整段充满，沿用现有仿真语义。
//       // uFillBounds: { value: new Float32Array([-1e6, 1e6, 0, 0]), type: "vec4<f32>" },
//       // uTint: { value: new Float32Array([1, 1, 1, 1]), type: "vec4<f32>" },
//       // uSkin: { value: new Float32Array([1, 1, 1, 1]), type: "vec4<f32>" },
//       // uSkin2: { value: new Float32Array([1, 1, 1, 1]), type: "vec4<f32>" },
//       // uFoam: { value: new Float32Array([1, 1, 1, 1]), type: "vec4<f32>" },
//       // uFluidType: { value: 0, type: "f32" },
//       uColor: { value: new Float32Array([1, 1, 1, 1]), type: "vec4<f32>" },
//       uParams: { value: new Float32Array([b.arrowSpeed ?? 1, b.flowSpeed ?? 1.25, b.timeOffset ?? 1, b.arrowSpace ?? 1]), type: "vec4<f32>" },
//       uPipe: { value: new Float32Array([p.staticDensity ?? .11, p.flowDensity ?? .18, p.flowOffset ?? 1.97, p.flowSpeed ?? 1.23]), type: "vec4<f32>" },
//       uWidths: { value: new Float32Array([p.staticWidth ?? .922, p.flowWidth ?? .88, p.waterWaveSpeed ?? .8, b.flowSpace ?? .27]), type: "vec4<f32>" },
//     });
//     this.uniforms.push(group);
//     const prefix = belt ? "conveyor" : "pipe";
//     const map = this.texture(`dynamic/${prefix}.${this.state.shape}.mapping`);
//     const glyph = this.texture(belt ? "dynamic/conveyor.arrow" : "dynamic/pipe.chevron");
//     const shader = new Shader({
//       glProgram: GlProgram.from({ name: "logistics-contract2", vertex: `#version 300 es\n${manifest.vertex}`, fragment: `#version 300 es\n${manifest.fragment}` }),
//       resources: {
//         materialUniforms: group,
//         uMap: map.source,
//         uGlyph: glyph.source,
//         uFlow: this.texture(belt ? "dynamic/conveyor.highlight" : "dynamic/pipe.fluid-motion").source,
//         uPattern: belt ? glyph.source : this.texture("dynamic/pipe.pattern").source,
//         uFluidMap: belt ? map.source : this.texture(`dynamic/pipe.${this.state.shape}.fluid-mapping`).source,
//         // AI-REMOVED 2026-09-13:
//         // Reason: 网站新增物流绘制延后接入，恢复当前正式 WebP 材质读取与 Shader 绑定。
//         // Trigger: 用户要求先导入其他素材，管道及传送带新绘制另行讨论。
//         // Evidence: 正式 logistics-contract2 manifest 使用 WebP，且未声明新 Shader 资源。
//         // Replacement: 当前正式 manifest 已声明的 uMap/uGlyph/uFlow/uPattern/uFluidMap
//         // Risk: Low; Human Review: Required
//         // Original code:
//         // uBase: map.source,
//         // uSplash: this.texture(belt ? "dynamic/conveyor.highlight" : "dynamic/pipe.splash-noise").source,
//       },
//     });
//     const mesh = new Mesh({
//       texture: Texture.WHITE,
//       shader,
//       geometry: new MeshGeometry({
//         positions: new Float32Array([0, 0, 128, 0, 128, 128, 0, 128]),
//         uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
//         indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
//       }),
//     });
//     mesh.label = "logistics-material-flow";
//     this.meshes.push(mesh);
//     return mesh;
//   }
// }
