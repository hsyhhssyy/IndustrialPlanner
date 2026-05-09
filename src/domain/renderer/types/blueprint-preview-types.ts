import type { BlueprintDocument } from "../../document/blueprint-document";

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