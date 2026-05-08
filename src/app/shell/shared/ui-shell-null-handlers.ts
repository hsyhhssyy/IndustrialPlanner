export function handleUiEvent(): void {}

export function preventNativeBrowserEvent(event: { preventDefault: () => void }): void {
  event.preventDefault();
}

export function preventTouchPointerCompatibilityMouseEvents(event: {
  pointerType: string;
  preventDefault: () => void;
}): void {
  if (event.pointerType === "touch" || event.pointerType === "pen") {
    event.preventDefault();
  }
}

export function preventMiddleMousePointerDownBrowserBehavior(event: {
  pointerType: string;
  button: number;
  preventDefault: () => void;
}): void {
  if (event.pointerType === "mouse" && event.button === 1) {
    event.preventDefault();
  }
}
