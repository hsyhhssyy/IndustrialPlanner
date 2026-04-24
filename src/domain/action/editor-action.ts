
import type {
	EditorViewportClientRect,
	EditorViewportPixelPoint,
} from "../state/types";

export interface MoveViewportByViewportPixelVectorOptions {
	readonly startViewportPixel: EditorViewportPixelPoint;
	readonly endViewportPixel: EditorViewportPixelPoint;
}

export interface EditorAction {
	setViewportClientRect(clientRect: EditorViewportClientRect): void;
	zoom(step: number): void;
	moveViewportByViewportPixelVector(
		options: MoveViewportByViewportPixelVectorOptions,
	): void;
}