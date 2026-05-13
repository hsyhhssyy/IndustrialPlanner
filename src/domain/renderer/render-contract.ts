import { RenderAction } from "./render-action";
import { RenderQuery } from "./render-query";


export interface RenderContract {
  canvas: HTMLCanvasElement;
  queries: RenderQuery;
  actions: RenderAction;
  destroy(): void;
}
