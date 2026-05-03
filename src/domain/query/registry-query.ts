import type { LogisticsKind } from "../types/logistics";

export interface RegistryQuery {
	isDedicatedLogisticsDevice(definitionId: string): boolean;
	resolveDedicatedLogisticsKind(definitionId: string): LogisticsKind | null;
	isGeneralLogisticsDevice(definitionId: string): boolean;
}
