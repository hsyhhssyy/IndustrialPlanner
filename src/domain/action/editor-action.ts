
import type {
	ClientPixelPoint,
	ClientPixelRect,
} from "../types/client-pixel";
import type { GridPoint, GridRect } from "../types/grid";
import type { EntityCollectionType, MarqueeCollectionType } from "../state/types";

export interface MoveViewportByClientPixelVectorOptions {
	readonly startClientPixel: ClientPixelPoint;
	readonly endClientPixel: ClientPixelPoint;
}

export interface EntityCollectionMemberOptions {
	readonly collectionType: EntityCollectionType;
	readonly entityId: string;
}

export interface MoveCollectionToOptions {
	readonly collectionType: EntityCollectionType;
	readonly startGridPoint: GridPoint;
	readonly endGridPoint: GridPoint;
}

export interface EditorAction {
	setViewportClientRect(clientRect: ClientPixelRect): void;
	/// 平移画布用的
	moveViewportByClientPixelVector(
		options: MoveViewportByClientPixelVectorOptions,
	): void;
	zoom(step: number): void;

	clearCollection(collectionType: EntityCollectionType): void;
	addToCollection(options: EntityCollectionMemberOptions): void;
	removeFromCollection(options: EntityCollectionMemberOptions): void;
	setMarqueeRange(collectionType: MarqueeCollectionType, gridRect: GridRect): void;
	applyMarquee(): void;
	cancelMarquee(): void;
	
	moveCollectionTo(options: MoveCollectionToOptions): void;
	rotateCollection(collectionType: EntityCollectionType): void;

	createMoveOperationDraft(): void;
	applyMoveOerationDraft(): boolean;
	cancelMoveOperationDraft(): void;

	createSinglePlacementDraft(deviceDefinitionId: string): void;
	applyPlacementDraft(): boolean;
	cancelPlacementDraft(): void;
}