
import type { WorldEntity } from "../entity/world-document";
import type { EntityCollectionType } from "../state/types";
import type {
	ClientPixelPoint,
	ClientPixelRect,
} from "../types/client-pixel";
import type {
	GridPoint,
	GridRect,
} from "../types/grid";

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

	canCreateLogisticsDraftStartHere(gridPoint: GridPoint, type: 'belt' | 'pipe'): boolean;
}
