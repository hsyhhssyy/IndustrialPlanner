import type { CanvasOperationAvailability, CanvasOperationId } from "./types/editor-session-types";
import type { WorldDocument, WorldEntity } from "../document/world-document";
import type {
	ClientPixelPoint,
// AI-REMOVED 2026-11-12: Reason: 相机移至 View；Trigger: REQ-048 D4；Evidence: 旧 viewport 已退役；Replacement: EditorView；Risk: 消费者待迁移；Human Review: Required
// Original code:
// 	ClientPixelRect,
} from "../shared/client-pixel";
import type {
	GridPoint,
	GridRect,
} from "../shared/grid";
import type {
	LogisticsDraftEndpoint,
	LogisticsDraftReadonlyState,
	LogisticsKind,
} from "../shared/logistics";
import type {
	EntityCollectionType,
  EditorViewState,
	EntityCollectionGeometry,
	EntityPlacementValidationResult,
} from "./types/editor-types";
import type { EditorBaseDocumentSummary } from "./editor-document";
import type { EditorHistoryRecord } from "./editor-history";
import type { RegionalDarkPipeLink } from "../shared/dark-pipe-link";

export interface EditorQuery {
	getOperationAvailability(operation: CanvasOperationId): CanvasOperationAvailability;
	/** 仅通知新提交的本地编辑；不回放加载、远端同步、撤销或重做。 */
	subscribeCommittedEdits(listener: (record: EditorHistoryRecord) => void): () => void;
	getEntityById(entityId: string): WorldEntity | null;
	listEntities(): readonly WorldEntity[];
	listPowerRangeProvidersCoveringGridRect(gridRect: GridRect): readonly WorldEntity[];
	findEntityAtClientPixelPoint(
		clientPixelPoint: ClientPixelPoint,
    viewport: EditorViewState,
	): WorldEntity | null;
	findEntityCollectionGridRect(
		collectionType: EntityCollectionType,
	): GridRect | null;
	findEntityCollectionGeometry(
		collectionType: EntityCollectionType,
	): EntityCollectionGeometry | null;
	getEntityPlacementValidation(entityId: string): EntityPlacementValidationResult;
	// AI-REMOVED 2026-11-12:
// Reason: 相机属于独立 View，Editor 不再持有或驱动视口。
// Trigger: REQ-048 已确认 D4 契约。
// Evidence: 同源多视图需要独立相机，无头会话不创建动画驱动。
// Replacement: EditorViewQuery
// Risk: 全部坐标、聚焦、持久化消费者需要迁移。
// Human Review: Required
// Original code:
// findGridCellForClientPixelPoint(
// 		clientPixelPoint: ClientPixelPoint,
// 	): GridPoint | null;
	// AI-REMOVED 2026-11-12:
// Reason: 相机属于独立 View，Editor 不再持有或驱动视口。
// Trigger: REQ-048 已确认 D4 契约。
// Evidence: 同源多视图需要独立相机，无头会话不创建动画驱动。
// Replacement: EditorViewQuery
// Risk: 全部坐标、聚焦、持久化消费者需要迁移。
// Human Review: Required
// Original code:
// findClientRectForGridCell(gridCell: {
// 		x: number;
// 		y: number;
// 	}): ClientPixelRect | null;

	resolveLogisticsDraftState(): LogisticsDraftReadonlyState | null;
	findLogisticsDraftEndpointAtGridPoint(
		gridPoint: GridPoint,
		kind: LogisticsKind,
	): LogisticsDraftEndpoint | null;
	canCreateLogisticsDraftStartHere(gridPoint: GridPoint, kind: LogisticsKind): boolean;
	listBaseDocumentSummaries(): Promise<readonly EditorBaseDocumentSummary[]>;
/**
 * 读取指定基地的最新持久化世界文档。当前内存文档不在此查询范围内；
 * 调用方负责用当前内存文档覆盖当前基地。
 * 订正（2026-09-25，REQ-038）：返回 Editor 最新内存版本；仅未加载基地读取存储，调用方无需再次覆盖。
 */
	readLatestBaseDocuments(baseIds: readonly string[]): Promise<readonly WorldDocument[]>;
	/** 当前区域文档派生的跨基地暗管关系；多基地关闭时为空。 */
	getRegionalDarkPipeLinks(): readonly RegionalDarkPipeLink[];
	/** 文档加载、修改、同步或释放通知；不暴露可写文档集合。 */
	subscribeBaseDocuments(listener: (baseIds: readonly string[]) => void): () => void;
	findRegionEntityIds(
		regionId: string,
		relation: "contained" | "boundary",
	): readonly string[];
}
