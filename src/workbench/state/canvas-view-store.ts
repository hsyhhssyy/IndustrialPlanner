import { makeAutoObservable } from "@/shared/mobx";
import { createSnapshotBridge } from "@/shared/mobx/snapshot-bridge";
import type { ReadonlySnapshotStore } from "@/workbench/state/workspace-store";
import type { CanvasViewState } from "@/workbench/state/workspace-state";
import { createInitialCanvasViewState } from "@/workbench/state/workspace-state";

function isSameCanvasPoint(
  left: CanvasViewState["offset"],
  right: CanvasViewState["offset"],
): boolean {
  return left.x === right.x && left.y === right.y;
}

export function isSameCanvasViewState(
  left: CanvasViewState,
  right: CanvasViewState,
): boolean {
  return left.zoom === right.zoom && isSameCanvasPoint(left.offset, right.offset);
}

export interface CanvasViewStore
  extends ReadonlySnapshotStore<CanvasViewState> {
  offset: CanvasViewState["offset"];
  zoom: number;
  setSnapshot: (state: Partial<CanvasViewState> | CanvasViewState) => boolean;
  update: (updater: (state: CanvasViewState) => CanvasViewState) => boolean;
}

class CanvasViewStoreImpl implements CanvasViewStore {
  offset: CanvasViewState["offset"];
  zoom: number;

  readonly #snapshotBridge;

  constructor(initialState: Partial<CanvasViewState> = {}) {
    const initialSnapshot = createInitialCanvasViewState(initialState);
    this.offset = {
      x: initialSnapshot.offset.x,
      y: initialSnapshot.offset.y,
    };
    this.zoom = initialSnapshot.zoom;
    this.#snapshotBridge = createSnapshotBridge(initialSnapshot);

    makeAutoObservable(
      this,
      {
        getSnapshot: false,
        subscribe: false,
      },
      {
        autoBind: true,
      },
    );
  }

  getSnapshot() {
    return this.#snapshotBridge.getSnapshot();
  }

  subscribe(listener: () => void) {
    return this.#snapshotBridge.subscribe(listener);
  }

  setSnapshot(state: Partial<CanvasViewState> | CanvasViewState): boolean {
    const nextSnapshot = createInitialCanvasViewState(state);
    const currentSnapshot = this.#snapshotBridge.getSnapshot();

    if (isSameCanvasViewState(currentSnapshot, nextSnapshot)) {
      return false;
    }

    this.applySnapshot(nextSnapshot);
    this.#snapshotBridge.publish(nextSnapshot);
    return true;
  }

  update(updater: (state: CanvasViewState) => CanvasViewState): boolean {
    const currentSnapshot = this.#snapshotBridge.getSnapshot();
    const nextSnapshot = updater(currentSnapshot);

    if (nextSnapshot === currentSnapshot) {
      return false;
    }

    return this.setSnapshot(nextSnapshot);
  }

  private applySnapshot(snapshot: CanvasViewState): void {
    if (!isSameCanvasPoint(this.offset, snapshot.offset)) {
      this.offset = {
        x: snapshot.offset.x,
        y: snapshot.offset.y,
      };
    }

    if (this.zoom !== snapshot.zoom) {
      this.zoom = snapshot.zoom;
    }
  }
}

export function createCanvasViewStore(
  initialState: Partial<CanvasViewState> = {},
): CanvasViewStore {
  return new CanvasViewStoreImpl(initialState);
}
