
import type {
	ClientPixelPoint,
	ClientPixelRect,
} from "../types/client-pixel";
import type { EntityCollectionType } from "../state/types";

export interface MoveViewportByClientPixelVectorOptions {
	readonly startClientPixel: ClientPixelPoint;
	readonly endClientPixel: ClientPixelPoint;
}

export interface EntityCollectionMemberOptions {
	readonly collectionType: EntityCollectionType;
	readonly entityId: string;
}

export interface EditorAction {
	setViewportClientRect(clientRect: ClientPixelRect): void;
	zoom(step: number): void;
	clearCollection(collectionType: EntityCollectionType): void;
	addToCollection(options: EntityCollectionMemberOptions): void;
	removeFromCollection(options: EntityCollectionMemberOptions): void;
	moveViewportByClientPixelVector(
		options: MoveViewportByClientPixelVectorOptions,
	): void;
}