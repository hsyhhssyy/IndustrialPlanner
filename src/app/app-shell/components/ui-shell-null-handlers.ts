export function handleUiEvent(): void {}

export function preventNativeBrowserEvent(event: { preventDefault: () => void }): void {
  event.preventDefault();
}
