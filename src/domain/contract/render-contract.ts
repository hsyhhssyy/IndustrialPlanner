import { RenderAction } from "../action/render-action";
import { RenderQuery } from "../query/render-query";


export interface RenderContract {
  queries: RenderQuery;
  actions: RenderAction;
}