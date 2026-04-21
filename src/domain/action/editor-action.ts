
import { EditorViewportClientRect } from "../state/types";

export interface EditorAction {
	setViewportClientRect(clientRect: EditorViewportClientRect): void;
}