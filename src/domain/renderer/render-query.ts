import type { BlueprintPreviewHandle } from "./types/blueprint-preview-types";

export interface RenderQuery {
	getBlueprintPreviewCanvas(handle: BlueprintPreviewHandle): HTMLCanvasElement | null;
}
