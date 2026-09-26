import { WorkspaceState } from "./workspace-state";
import { AppContract } from "../app/app-contract";
import { EditorContract } from "../editor/editor-contract";
import { RegistryContract } from "../registry/registry-contract";
import { RenderContract } from "../renderer/render-contract";
import { SimulationContract } from "../simulation/simulation-contract";
import type { SyncContract } from "../sync/sync-contract";
import type { BlueprintPlannerContract } from "../blueprint-planner/blueprint-planner-contract";
import type { AudioContract } from "../audio";


export interface WorkspaceContract {
    readonly state : WorkspaceState;
    registry: RegistryContract;
    app: AppContract | null;
    audio: AudioContract | null;
    editor: EditorContract | null;
    render: RenderContract | null;
    simulation: SimulationContract | null;
    sync: SyncContract | null;
    blueprintPlanner: BlueprintPlannerContract | null;
}
