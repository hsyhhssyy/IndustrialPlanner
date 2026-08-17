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

export interface EditorQuery {
	getEntityById(entityId: string): WorldEntity | null;
	listEntities(): readonly WorldEntity[];
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
 */
readLatestBaseDocuments(baseIds: readonly string[]): Promise<readonly WorldDocument[]>;
}
