
import type { WorldEntity } from "../entity/world-document";
import type { EditorViewportPixelPoint } from "../state/types";

export interface EditorQuery {
	findEntityAtViewportPoint(
		viewportPoint: EditorViewportPixelPoint,
	): WorldEntity | null;
}