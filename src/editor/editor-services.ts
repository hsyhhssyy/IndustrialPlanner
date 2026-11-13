import type { WorkspaceContract } from "@/domain/document/workspace-contract";

/** 编辑算法只依赖 Registry；主工作台可显式提供跨基地维护服务。 */
export type EditorServices = Pick<WorkspaceContract, "registry">
  & Partial<Pick<WorkspaceContract, "app" | "simulation">>
  & { readonly placement?: EditorPlacementSpace; readonly includeBaseBuiltins?: boolean };

export interface EditorPlacementSpace {
  readonly space: import("@/domain/shared/scene-space").SceneSpace;
  readonly resolvePlacementAreaIds: (
    entity: import("@/domain/document/world-document").WorldEntity,
    space: import("@/domain/shared/scene-space").SceneSpace,
  ) => readonly string[];
}
