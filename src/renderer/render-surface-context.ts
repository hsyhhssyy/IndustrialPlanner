import type { WorkspaceContract } from "@/domain/document/workspace-contract"
import type { Application } from "pixi.js"

import type { createTextureActions } from "./texture/texture-manager"

export interface RenderSurfaceContext {
  readonly workspace: WorkspaceContract
  readonly app: Application
  readonly textureManager: ReturnType<typeof createTextureActions>
  readonly internalState: {
    textureConfig: unknown | null
  }
}
