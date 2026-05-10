import type { GridPoint } from "../shared/grid";
import { createUuid } from "../shared/uuid";
import type {
	SlotLinkDefinition,
	WorldDocument,
	WorldEntity,
} from "./world-document";

export const BLUEPRINT_SCHEMA_VERSION = 1;
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

export function createWorldDocumentFromBlueprint(
	blueprint: BlueprintDocument,
): WorldDocument {
	return {
		schemaVersion: 1,
		documentKey: blueprint.blueprintId,
		baseId: blueprint.baseId,
		meta: {
			id: `blueprint-${blueprint.blueprintId}`,
			name: blueprint.name,
			createdAt: blueprint.createdAt,
			updatedAt: blueprint.updatedAt,
		},
		entities: cloneBlueprintEntities(blueprint.entities),
		entityOrder: [...blueprint.entityOrder],
		slotLinks: blueprint.slotLinks.map(cloneSlotLinkDefinition),
		documentSettings: {
			viewport: {
				center: {
					x: 0,
					y: 0,
				},
				gridSize: 1,
			},
		},
	};
}

function cloneBlueprintEntities(
	entities: BlueprintDocument["entities"],
): Record<string, WorldEntity> {
	const nextEntities: Record<string, WorldEntity> = {};

	for (const [entityId, entity] of Object.entries(entities)) {
		nextEntities[entityId] = {
			...entity,
			position: {
				x: entity.position.x,
				y: entity.position.y,
			},
			config: { ...entity.config },
			tags: [...entity.tags],
		};
	}

	return nextEntities;
}

function cloneSlotLinkDefinition(slotLink: SlotLinkDefinition): SlotLinkDefinition {
	return {
		...slotLink,
		source: {
			...slotLink.source,
		},
		target: {
			...slotLink.target,
		},
	};
}
