
import type { WorldEntity } from "../entity/world-document";
import type {
	ClientPixelPoint,
	ClientPixelRect,
} from "../types/client-pixel";

export interface EditorQuery {
	findEntityAtClientPixelPoint(
		clientPixelPoint: ClientPixelPoint,
	): WorldEntity | null;
	findClientRectForGridCell(gridCell: {
		x: number;
		y: number;
	}): ClientPixelRect | null;
}