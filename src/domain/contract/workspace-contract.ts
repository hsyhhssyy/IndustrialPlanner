import { WorkspaceState } from "../state/workspace-state";
import { AppContract } from "./app-contract";
import { EditorContract } from "./editor-contract";
import { RegistryContract } from "./registry-contracts";
import { RenderContract } from "./render-contract";
import { SimulationContract } from "./simulation-contract";


export interface WorkspaceContract {
    state : WorkspaceState;
    registry: RegistryContract;
    app: AppContract | null;
    editor: EditorContract | null;
    render: RenderContract | null;
    simulation: SimulationContract | null;
}
