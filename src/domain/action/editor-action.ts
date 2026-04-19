
import { EditorViewportPixelSize } from "../state/types";

export interface EditorAction {
	setViewportPixelSize(pixelSize: EditorViewportPixelSize): void;
}