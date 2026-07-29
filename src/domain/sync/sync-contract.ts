import type { SyncAction } from "./sync-action";
import type { SyncQuery } from "./sync-query";
import type { SyncState } from "./sync-state";

export interface SyncContract {
  readonly state: SyncState;
  readonly actions: SyncAction;
  readonly queries: SyncQuery;
}
