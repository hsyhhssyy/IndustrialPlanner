import { WorkspaceState } from "../types/workspace/types";
import { AppContract } from "./app-contract";
import { RegistryContract } from "./registry-contracts";


export interface WorkspaceContract {
    state : WorkspaceState;
    app: AppContract;
    registry: RegistryContract;
}
