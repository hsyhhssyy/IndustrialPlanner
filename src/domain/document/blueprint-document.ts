import type { GridPoint } from "../shared/grid";
import { createUuid } from "../shared/uuid";
import type {
	SlotLinkDefinition,
	WorldEntity,
} from "./world-document";

export const BLUEPRINT_SCHEMA_VERSION = 3;
export const BLUEPRINT_VERSION = "v1.3.0";

export interface BlueprintDocument {
	schemaVersion: number;
	blueprintId: string;
	version: string;
	name: string;
	description: string;
	baseId: string;
	initialGridPoint: GridPoint;
	entities: Record<string, WorldEntity>;
	entityOrder: string[];
	slotLinks: SlotLinkDefinition[];
	createdAt: string;
	updatedAt: string;
}

export interface CreateBlueprintDocumentInput {
	blueprintId?: string;
	version?: string;
	name: string;
	description?: string;
	baseId: string;
	initialGridPoint: GridPoint;
	entities: Record<string, WorldEntity>;
	entityOrder: string[];
	slotLinks: SlotLinkDefinition[];
	createdAt?: string;
	updatedAt?: string;
}

export function createBlueprintDocument(
	input: CreateBlueprintDocumentInput,
): BlueprintDocument {
	const timestamp = input.createdAt ?? new Date().toISOString();

	return {
		schemaVersion: BLUEPRINT_SCHEMA_VERSION,
		blueprintId: input.blueprintId ?? createUuid(),
		version: input.version ?? BLUEPRINT_VERSION,
		name: input.name.trim(),
		description: input.description?.trim() ?? "",
		baseId: input.baseId,
		initialGridPoint: input.initialGridPoint,
		entities: input.entities,
		entityOrder: [...input.entityOrder],
		slotLinks: [...input.slotLinks],
		createdAt: timestamp,
		updatedAt: input.updatedAt ?? timestamp,
	};
}

