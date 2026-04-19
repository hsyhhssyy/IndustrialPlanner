import { makeAutoObservable } from "mobx";

import type { UiState } from "@/domain/state/types";

export interface UiStateReadWrite extends UiState {
  leftDockOpen: boolean;
  rightDockOpen: boolean;
  bottomBarOpen: boolean;
  activePanel: "placement" | "delete" | "blueprint" | "history" | null;
}

export class UiStateReadWriteImpl implements UiStateReadWrite {
  leftDockOpen = true;
  rightDockOpen = true;
  bottomBarOpen = true;
  activePanel: "placement" | "delete" | "blueprint" | "history" | null = null;

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
}

export function createUiStateReadWrite(): UiStateReadWrite {
  return new UiStateReadWriteImpl();
}