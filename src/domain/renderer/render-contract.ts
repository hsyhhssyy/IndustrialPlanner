import { RenderAction } from "./render-action";
import { RenderQuery } from "./render-query";
import type { Texture } from "pixi.js";


export interface RenderContract {
  canvas: HTMLCanvasElement;
  textureManager: {
    getTexture(unifiedResourceKey: string): Promise<Texture>;
    destroy(): void;
  };
  queries: RenderQuery;
  actions: RenderAction;
  destroy(): void;
}
