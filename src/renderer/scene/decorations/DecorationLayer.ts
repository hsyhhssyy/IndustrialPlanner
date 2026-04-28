import type { Container } from "pixi.js";
import type { DecorationSyncContext } from "./DecorationSyncContext";

export interface DecorationLayer {
  readonly container: Container;
  sync(context: DecorationSyncContext): void;
  destroy(): void;
}
