import type { BlueprintPreviewHandle, BlueprintPreviewPoint } from "./types/blueprint-preview-types";

export interface RenderQuery {
	blueprintPreviewScreenToGrid(handle: BlueprintPreviewHandle, point: BlueprintPreviewPoint): BlueprintPreviewPoint | null;
	getBlueprintPreviewCanvas(handle: BlueprintPreviewHandle): HTMLCanvasElement | null;
}
