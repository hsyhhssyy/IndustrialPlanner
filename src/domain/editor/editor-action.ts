import type {
	EntityCollectionType,
	MarqueeCollectionType,
	MoveViewportByClientPixelVectorOptions,
	EntityCollectionMemberOptions,
	MoveCollectionToOptions,
} from "./types/editor-types";
import type { ClientPixelRect } from "../shared/client-pixel";
import type { GridPoint, GridRect, GridRotation } from "../shared/grid";
import type {
	CreateLogisticsDraftStartOptions,
	LogisticsDraftActionResult,
	MoveLogisticsDraftEndOptions,
} from "../shared/logistics";
import type { BlueprintDocument } from "../document/blueprint-document";
import type { WorldDocumentSettings } from "../document/world-document";

export interface EditorAction {
	setViewportClientRect(clientRect: ClientPixelRect): void;
	/// 平移画布用的
	moveViewportByClientPixelVector(
		options: MoveViewportByClientPixelVectorOptions,
	): void;
	zoom(step: number): void;
	setViewportDisplayRotation(displayRotation: GridRotation): void;

	patchEntityConfig(entityId: string, patch: Record<string, unknown>): void;
	/**
	 * 将实体或运行时 draft 切换为另一个 definition。
	 * 切换会清空该实体 config；若目标是正式文档实体，还会移除涉及该实体的 document slotLinks。
	 */
	replaceEntityDefinition(entityId: string, nextDefinitionId: string): boolean;
	/**
	 * 删除实体 config 中的指定键。
	 * 父键被删时，以该键为前缀的子键一并删除（如删 `links[0]` 则 `links[0].id`、`links[0].source.entityId` 等均被移除）。
	 * 只影响 config，不影响 entity 其他字段。
	 */
	deleteEntityConfigKeys(entityId: string, keys: string[]): void;

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
	/**
	 * 批量删除严格物流设备（传送带或管道）。
	 * 从指定设备出发，沿同种类（belt/pipe）链路 BFS 删除所有连通的严格物流设备，
	 * 遇到非严格物流设备（分流器、汇流器、连接器、生产设备等）时停止该方向遍历。
	 * 若指定设备不是严格物流设备，则什么也不做。
	 * 注意：belt 系与 pipe 系隔离，即使两设备占据同一格也不会跨种类传播删除。
	 */
	removeTransportComponent(entityId: string): void;
	/**
	 * 删除上游物流段：从指定设备出发，沿 input 方向 BFS 删除当前设备及所有上游严格物流设备。
	 */
	removeTransportComponentUpstream(entityId: string): void;
	/**
	 * 删除下游物流段：从指定设备出发，沿 output 方向 BFS 删除当前设备及所有下游严格物流设备。
	 */
	removeTransportComponentDownstream(entityId: string): void;

	loadLatestBaseDocument(baseId: string): Promise<boolean>;
	/**
	 * 静默写入 documentSettings 的部分字段（silent 模式，不进入 undo/redo）。
	 * 适用于 powerMode、viewport 等不需要触发全量重编译的文档设置变更。
	 */
	writeDocumentSettings(patch: Partial<WorldDocumentSettings>): void;
}
