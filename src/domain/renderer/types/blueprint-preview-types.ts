import type { BlueprintDocument } from "../../document/blueprint-document";
import type { GridBounds, GridPoint } from "../../shared/grid";

export type BlueprintPreviewPoint = GridPoint;

export interface BlueprintPreviewLink {
  readonly sourceEntityId: string;
  readonly targetEntityId: string;
  readonly binding: boolean;
}

export interface BlueprintPreviewOverlay {
  readonly selectedEntityIds: readonly string[];
  readonly invalidEntityIds: readonly string[];
  readonly productionItemIds: Readonly<Record<string, readonly string[]>>;
  readonly links: readonly BlueprintPreviewLink[];
}

export interface BlueprintPreviewScene {
  readonly blueprint: BlueprintDocument;
  readonly overlay?: BlueprintPreviewOverlay;
}

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
	/** 固定视口边界，传入后不根据蓝图实体自动计算 bounds */
	viewportBounds?: GridBounds;
	/** 需要在预览中叠加扫描线高亮特效的实体 ID */
	highlightedEntityId?: string;
}
