import { makeAutoObservable } from "mobx";

import type { ClientPixelPoint } from "@/domain/shared/client-pixel";

export interface OverlapEntityMenuCandidate {
  readonly entityId: string;
  readonly definitionId: string;
}

export interface OverlapEntityMenuOpenRequest {
  readonly position: ClientPixelPoint;
  readonly candidates: readonly OverlapEntityMenuCandidate[];
  readonly onSelect: (entityId: string) => void;
  readonly onCancel?: () => void;
}

export class WorkbenchOverlapEntityMenuController {
  visible = false;
  position: ClientPixelPoint | null = null;
  candidates: OverlapEntityMenuCandidate[] = [];

  _onSelect: ((entityId: string) => void) | null = null;
  _onCancel: (() => void) | null = null;

  public constructor() {
    makeAutoObservable(this, {
      _onSelect: false,
      _onCancel: false,
    }, { autoBind: true });
  }

  public open(request: OverlapEntityMenuOpenRequest): void {
    const candidates = dedupeCandidates(request.candidates);
    if (candidates.length <= 1) {
      this.cancel();
      return;
    }

    this.visible = true;
    this.position = {
      x: Math.round(request.position.x),
      y: Math.round(request.position.y),
    };
    this.candidates = candidates;
    this._onSelect = request.onSelect;
    this._onCancel = request.onCancel ?? null;
  }

  public select(entityId: string): void {
    if (!this.visible || !this.candidates.some((candidate) => candidate.entityId === entityId)) {
      return;
    }

    const onSelect = this._onSelect;
    this.clear();
    onSelect?.(entityId);
  }

  public cancel(): void {
    const onCancel = this._onCancel;
    this.clear();
    onCancel?.();
  }

  public dispose(): void {
    this.cancel();
  }

  private clear(): void {
    this.visible = false;
    this.position = null;
    this.candidates = [];
    this._onSelect = null;
    this._onCancel = null;
  }
}

function dedupeCandidates(
  candidates: readonly OverlapEntityMenuCandidate[],
): OverlapEntityMenuCandidate[] {
  const seen = new Set<string>();
  const deduped: OverlapEntityMenuCandidate[] = [];

  for (const candidate of candidates) {
    if (seen.has(candidate.entityId)) {
      continue;
    }

    seen.add(candidate.entityId);
    deduped.push(candidate);
  }

  return deduped;
}
