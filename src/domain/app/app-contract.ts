import { AppAction } from "./app-action";
import { AppQuery } from "./app-query";
import { UiState } from "./types/app-types";

export interface AppContract {
    readonly state: UiState;
    queries: AppQuery;
    actions: AppAction;
}
