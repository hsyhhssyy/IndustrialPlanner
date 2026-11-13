import type { WorldDocument } from "../document/world-document";
import { EditorAction } from "./editor-action";
import { EditorQuery } from "./editor-query";
import { EditorState } from "./editor-state";
import type { SceneSnapshotSource } from "../shared/scene-snapshot";

// AI-REMOVED 2026-11-12:
// Reason: 场景共享契约迁入 Domain Shared，避免 Editor/App 各有一份语义。
// Trigger: REQ-048 已确认 D2 契约。
// Evidence: 会话、只读源与交互画布均需要相同标识和只读快照。
// Replacement: domain/shared/scene-snapshot.ts
// Risk: 所有引用需同步迁移。
// Human Review: Required
// Original code:
// export type { EditorSnapshotStore } from "./types/editor-types";

export interface EditorContract {
  document: SceneSnapshotSource<WorldDocument>;
  readonly state: EditorState;
  queries: EditorQuery;
  actions: EditorAction;
}
