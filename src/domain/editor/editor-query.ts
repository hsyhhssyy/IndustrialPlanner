import type { WorldDocument, WorldEntity } from "../document/world-document";
import type {
	ClientPixelPoint,
	ClientPixelRect,
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
	EntityCollectionGeometry,
	EntityPlacementValidationResult,
} from "./types/editor-types";
import type { EditorBaseDocumentSummary } from "./editor-document";
import type { RegionalDarkPipeLink } from "../shared/dark-pipe-link";

export interface EditorQuery {
	getEntityById(entityId: string): WorldEntity | null;
	listEntities(): readonly WorldEntity[];
	listPowerRangeProvidersCoveringGridRect(gridRect: GridRect): readonly WorldEntity[];
	findEntityAtClientPixelPoint(
		clientPixelPoint: ClientPixelPoint,
	): WorldEntity | null;
	findEntityCollectionGridRect(
		collectionType: EntityCollectionType,
	): GridRect | null;
	findEntityCollectionGeometry(
		collectionType: EntityCollectionType,
	): EntityCollectionGeometry | null;
	getEntityPlacementValidation(entityId: string): EntityPlacementValidationResult;
	findGridCellForClientPixelPoint(
		clientPixelPoint: ClientPixelPoint,
	): GridPoint | null;
	findClientRectForGridCell(gridCell: {
		x: number;
		y: number;
	}): ClientPixelRect | null;

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
