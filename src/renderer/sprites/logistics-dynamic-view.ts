import { Container, GlProgram, Mesh, MeshGeometry, Shader, Sprite, Texture, UniformGroup } from "pixi.js";
import type { LogisticsMaterialEntityState, LogisticsMaterialFrameState } from "@/shared/logistics-material";
import type { LogisticsDynamicAssets } from "../texture";

/** 一个实体的材质分层；所有实例复用纹理及编译后的 GlProgram。 */
export class LogisticsDynamicView {
  public readonly root = new Container();
  private readonly supportLayers: Sprite[] = [];
  private readonly fluidLayers: Container[] = [];
  private readonly meshes: Mesh<MeshGeometry, Shader>[] = [];
  private readonly uniforms: UniformGroup[] = [];
  private fluid: Sprite | null = null;
  private previousState: LogisticsMaterialEntityState | null = null;
  private previousTime = Number.NaN;

  public constructor(private readonly assets: LogisticsDynamicAssets, private readonly state: LogisticsMaterialEntityState) {
    this.root.pivot.set(64, 64);
    const sprite = (suffix: string) => {
      const image = new Sprite(this.texture(`static/${state.kind === "belt" ? "conveyor" : "pipe"}.${state.shape}.${suffix}`));
      this.root.addChild(image);
      return image;
    };
    if (state.kind === "belt") {
      sprite("base");
      this.root.addChild(this.createOverlay(0));
    } else {
      this.supportLayers.push(sprite("support-back"));
      this.fluid = sprite("fluid-body");
      this.fluidLayers.push(this.fluid);
      const shimmer = this.createOverlay(1);
      this.root.addChild(shimmer);
      this.fluidLayers.push(shimmer, sprite("fluid-specular"));
      this.supportLayers.push(sprite("support-middle"));
      sprite("shell");
      this.root.addChild(this.createOverlay(0));
      this.supportLayers.push(sprite("support-front"));
    }
  }

  public sync(state: LogisticsMaterialEntityState, frame: LogisticsMaterialFrameState): void {
    const time = state.kind === "belt" ? frame.beltSeconds : frame.pipeSeconds;
    if (this.previousState === state && this.previousTime === time) return;
    this.previousState = state;
    this.previousTime = time;
    const filled = state.color !== "empty";
    for (const sprite of this.supportLayers) sprite.visible = state.support;
    for (const sprite of this.fluidLayers) sprite.visible = filled;
    if (this.fluid && filled) this.fluid.tint = Number.parseInt(state.color, 16);
    for (const group of this.uniforms) {
      group.uniforms.uStart = state.start;
      group.uniforms.uFilled = filled ? 1 : 0;
      group.uniforms.uTime = state.kind === "belt" ? frame.beltSeconds : frame.pipeSeconds;
      group.update();
    }
  }

  public destroy(): void {
    for (const mesh of this.meshes) {
      mesh.shader?.destroy();
      mesh.geometry.destroy();
    }
    this.root.destroy({ children: true });
  }

  private texture(key: string): Texture {
    const texture = this.assets.textures.get(key);
    if (!texture) throw new Error(`Missing logistics material texture: ${key}`);
    return texture;
  }

  private createOverlay(layer: number): Mesh<MeshGeometry, Shader> {
    const { manifest } = this.assets;
    const belt = this.state.kind === "belt";
    const b = manifest.belt;
    const p = manifest.pipe;
    const group = new UniformGroup({
      uTime: { value: 0, type: "f32" },
      uStart: { value: this.state.start, type: "f32" },
      uKind: { value: belt ? 0 : 1, type: "f32" },
      uCorner: { value: this.state.shape === "straight" ? 0 : 1, type: "f32" },
      uFilled: { value: 0, type: "f32" },
      uDirection: { value: p.waterDirection ?? 0, type: "f32" },
      uLayer: { value: layer, type: "f32" },
      uAtlasHalfTexel: { value: .5 / 2048, type: "f32" },
      uParams: { value: new Float32Array([b.arrowSpeed ?? 1, b.flowSpeed ?? 1.25, b.timeOffset ?? 1, b.arrowSpace ?? 1]), type: "vec4<f32>" },
      uPipe: { value: new Float32Array([p.staticDensity ?? .11, p.flowDensity ?? .18, p.flowOffset ?? 1.97, p.flowSpeed ?? 1.23]), type: "vec4<f32>" },
      uWidths: { value: new Float32Array([p.staticWidth ?? .922, p.flowWidth ?? .88, p.waterWaveSpeed ?? .8, b.flowSpace ?? .27]), type: "vec4<f32>" },
    });
    this.uniforms.push(group);
    const prefix = belt ? "conveyor" : "pipe";
    const map = this.texture(`dynamic/${prefix}.${this.state.shape}.mapping`);
    const glyph = this.texture(belt ? "dynamic/conveyor.arrow" : "dynamic/pipe.chevron");
    const shader = new Shader({
      glProgram: GlProgram.from({ name: "logistics-contract2", vertex: `#version 300 es\n${manifest.vertex}`, fragment: `#version 300 es\n${manifest.fragment}` }),
      resources: {
        materialUniforms: group,
        uMap: map.source,
        uGlyph: glyph.source,
        uFlow: this.texture(belt ? "dynamic/conveyor.highlight" : "dynamic/pipe.fluid-motion").source,
        uPattern: belt ? glyph.source : this.texture("dynamic/pipe.pattern").source,
        uFluidMap: belt ? map.source : this.texture(`dynamic/pipe.${this.state.shape}.fluid-mapping`).source,
      },
    });
    const mesh = new Mesh({
      texture: Texture.WHITE,
      shader,
      geometry: new MeshGeometry({
        positions: new Float32Array([0, 0, 128, 0, 128, 128, 0, 128]),
        uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
        indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      }),
    });
    mesh.label = "logistics-material-flow";
    this.meshes.push(mesh);
    return mesh;
  }
}
