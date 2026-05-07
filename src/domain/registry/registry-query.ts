import type { LogisticsKind } from "../shared/logistics";

export interface RegistryQuery {
	isDedicatedLogisticsDevice(definitionId: string): boolean;
	resolveDedicatedLogisticsKind(definitionId: string): LogisticsKind | null;
	isGeneralLogisticsDevice(definitionId: string): boolean;
}
