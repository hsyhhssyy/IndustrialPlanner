import { WorkspaceState } from "./workspace-state";
import { AppContract } from "../app/app-contract";
import { EditorContract } from "../editor/editor-contract";
import { RegistryContract } from "../registry/registry-contract";
import { RenderContract } from "../renderer/render-contract";
import { SimulationContract } from "../simulation/simulation-contract";


export interface WorkspaceContract {
    readonly state : WorkspaceState;
    registry: RegistryContract;
    app: AppContract | null;
    editor: EditorContract | null;
    render: RenderContract | null;
    simulation: SimulationContract | null;
}
