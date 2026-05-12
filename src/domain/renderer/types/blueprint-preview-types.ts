import type { BlueprintDocument } from "../../document/blueprint-document";
import type { GridBounds } from "../../shared/grid";

export type BlueprintPreviewHandle = string;

export interface BlueprintPreviewViewport {
	zoom: number;
	offsetX: number;
	offsetY: number;
}

export interface MountBlueprintPreviewOptions {
	blueprint: BlueprintDocument;
	width: number;
	height: number;
	viewport?: Partial<BlueprintPreviewViewport>;
}

export interface MountNeighborhoodPreviewOptions {
	blueprint: BlueprintDocument;
	/** 固定的视口矩形（网格坐标），内容会被裁切到此边界 */
	viewportBounds: GridBounds;
	/** 需要扫描线高亮的实体 ID */
	highlightedEntityId: string;
	/** 可用容器宽度 */
	width: number;
	/** 可用容器高度 */
	height: number;
}