import type { GridPoint } from "../shared/grid";
import { createUuid } from "../shared/uuid";
import type {
	SlotLinkDefinition,
	WorldEntity,
} from "./world-document";
import type { RegionAnnotation } from "./region-annotation";

// AI-CORRECTION 2026-08-19: schema 5 将资源泵的仓库代理配置迁移为真实手选配方或对应作弊设备。
// AI-CORRECTION 2026-09-09: schema 6 新增可选来源的区域标记，普通蓝图仍保存空数组。
// AI-CORRECTION 2026-09-11: schema 7 承载 AKEData 端口朝向兼容迁移；schema 6 文档必须先经过 6→7。
export const BLUEPRINT_SCHEMA_VERSION = 7;

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
	regions: readonly RegionAnnotation[];
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
	regions?: readonly RegionAnnotation[];
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
		version: input.version ?? "",
		name: input.name.trim(),
		description: input.description?.trim() ?? "",
		baseId: input.baseId,
		initialGridPoint: input.initialGridPoint,
		entities: input.entities,
		entityOrder: [...input.entityOrder],
		slotLinks: [...input.slotLinks],
		regions: (input.regions ?? []).map((region) => ({
			...region,
			rects: region.rects.map((rect) => ({ ...rect })),
		})),
		createdAt: timestamp,
		updatedAt: input.updatedAt ?? timestamp,
	};
}
