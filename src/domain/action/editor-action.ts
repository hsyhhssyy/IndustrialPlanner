
import type {
	ClientPixelPoint,
	ClientPixelRect,
} from "../types/client-pixel";

export interface MoveViewportByClientPixelVectorOptions {
	readonly startClientPixel: ClientPixelPoint;
	readonly endClientPixel: ClientPixelPoint;
}

export interface EditorAction {
	setViewportClientRect(clientRect: ClientPixelRect): void;
	zoom(step: number): void;
	selectEntity(entityId: string): void;
	moveViewportByClientPixelVector(
		options: MoveViewportByClientPixelVectorOptions,
	): void;
}