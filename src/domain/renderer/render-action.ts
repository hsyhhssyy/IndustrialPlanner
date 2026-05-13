import type {
	BlueprintPreviewHandle,
	BlueprintPreviewViewport,
	MountBlueprintPreviewOptions,
} from "./types/blueprint-preview-types";

export interface RenderAction {
	mountBlueprintPreview(
		options: MountBlueprintPreviewOptions,
	): Promise<BlueprintPreviewHandle>;
	updateBlueprintPreviewViewport(
		handle: BlueprintPreviewHandle,
		viewport: Partial<BlueprintPreviewViewport>,
	): void;
	resizeBlueprintPreview(
		handle: BlueprintPreviewHandle,
		width: number,
		height: number,
	): void;
	disposeBlueprintPreview(handle: BlueprintPreviewHandle): void;
}
