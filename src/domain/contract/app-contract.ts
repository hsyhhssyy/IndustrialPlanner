import { AppAction } from "../action/app-action";
import { AppQuery } from "../query/app-query";

export interface AppContract {
    queries: AppQuery;
    actions: AppAction;
}