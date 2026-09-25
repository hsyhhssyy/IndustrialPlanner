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
// AI-CORRECTION 2026-09-11: 远端 v1.5.0 发布 schema 为 5；未发布的区域、端口和变体 ID 变更统一为 schema 6，撤回额外版本 7。
// USER-REQUIREMENT 2026-09-18: 升级本常量前必须先核查当前 schema 是否已进入生产环境；若当前目标版本尚未上线，所有新增迁移必须继续并入既有“生产版本 → 当前目标版本”步骤。当前生产版本为 5、目标版本 6，因此继续追加到 5→6，禁止新建 6→7。
// USER-REQUIREMENT 2026-09-25: 当前版本仍未发布；跨基地暗管文档改造及蓝图过滤不升级版本，迁移目标继续为 6。
export const BLUEPRINT_SCHEMA_VERSION = 6;

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
		// 蓝图只携带本地连接；即使远端实体 ID 与本地重名，也不能复制其引用。
		slotLinks: input.slotLinks.filter((link) =>
			(link.source.baseId === undefined || link.source.baseId === input.baseId)
			&& (link.target.baseId === undefined || link.target.baseId === input.baseId),
		).map((link) => ({
			...link,
			// 显式引用自身基地的端点转换为蓝图内相对端点，支持放置到另一个基地。
			source: {
				entityId: link.source.entityId,
				storageSlotGroupId: link.source.storageSlotGroupId,
				slotId: link.source.slotId,
			},
			target: {
				entityId: link.target.entityId,
				storageSlotGroupId: link.target.storageSlotGroupId,
				slotId: link.target.slotId,
			},
		})),
		regions: (input.regions ?? []).map((region) => ({
			...region,
			rects: region.rects.map((rect) => ({ ...rect })),
		})),
		createdAt: timestamp,
		updatedAt: input.updatedAt ?? timestamp,
	};
}
