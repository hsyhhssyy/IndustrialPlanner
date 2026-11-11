import type {
	BlueprintPreviewHandle,
	BlueprintPreviewViewport,
	MountBlueprintPreviewOptions,
	BlueprintPreviewScene,
} from "./types/blueprint-preview-types";

export interface RenderAction {
	updateBlueprintPreviewScene(handle: BlueprintPreviewHandle, scene: BlueprintPreviewScene): void;
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
