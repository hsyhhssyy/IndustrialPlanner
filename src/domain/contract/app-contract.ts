import { AppAction } from "../action/app-action";
import { AppQuery } from "../query/app-query";
import { UiState } from "../state/types";

export interface AppContract {
    readonly state: UiState;
    queries: AppQuery;
    actions: AppAction;
}