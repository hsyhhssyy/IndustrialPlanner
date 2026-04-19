import { RenderAction } from "../action/render-action";
import { RenderQuery } from "../query/render-query";


export interface RenderContract {
  canvas: HTMLCanvasElement;
  queries: RenderQuery;
  actions: RenderAction;
}