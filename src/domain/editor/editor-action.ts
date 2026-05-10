import type {
	EntityCollectionType,
	MarqueeCollectionType,
	MoveViewportByClientPixelVectorOptions,
	EntityCollectionMemberOptions,
	MoveCollectionToOptions,
} from "./types/editor-types";
import type { ClientPixelRect } from "../shared/client-pixel";
import type { GridPoint, GridRect } from "../shared/grid";
import type {
	CreateLogisticsDraftStartOptions,
	LogisticsDraftActionResult,
	MoveLogisticsDraftEndOptions,
} from "../shared/logistics";
import type { BlueprintDocument } from "../document/blueprint-document";

export interface EditorAction {
	setViewportClientRect(clientRect: ClientPixelRect): void;
	/// 平移画布用的
	moveViewportByClientPixelVector(
		options: MoveViewportByClientPixelVectorOptions,
	): void;
	zoom(step: number): void;

	patchEntityConfig(entityId: string, patch: Record<string, unknown>): void;

	clearCollection(collectionType: EntityCollectionType): void;
	deleteCollection(collectionType: EntityCollectionType): void;
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

	createSinglePlacementDraft(deviceDefinitionId: string, centerGridPoint: GridPoint): void;
	createBlueprintPlacementDraft?(blueprint: BlueprintDocument, centerGridPoint: GridPoint): void;
	applyPlacementDraft(): boolean;
	cancelPlacementDraft(): void;

	createLogisticsDraftStart(
		options: CreateLogisticsDraftStartOptions,
	): LogisticsDraftActionResult;
	moveLogisticEnd(options: MoveLogisticsDraftEndOptions): LogisticsDraftActionResult;
	applyLogisticDraft(): boolean;
	cancelLogisticsDraft(): void;

	undoDocumentHistory(): boolean;
	redoDocumentHistory(): boolean;
	restoreDocumentHistoryTo(sequence: number): boolean;
	clearDocumentHistory(): void;
}
