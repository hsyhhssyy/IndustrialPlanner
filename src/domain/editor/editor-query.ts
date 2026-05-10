import type { WorldEntity } from "../document/world-document";
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
import type { EntityCollectionType } from "./types/editor-types";
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
	findGridCellForClientPixlePoint(
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
}
