import type { BlueprintDocument } from "@/domain/document/blueprint-document";

export interface BlueprintPreviewRenderer {
  mount: () => void;
  render: () => void;
  dispose: () => void;
}

export interface CreateBlueprintPreviewRendererInput {
  readonly blueprint: BlueprintDocument;
  readonly canvasElement: HTMLCanvasElement;
}

export type BlueprintPreviewRendererFactory = (
  input: CreateBlueprintPreviewRendererInput,
) => BlueprintPreviewRenderer;