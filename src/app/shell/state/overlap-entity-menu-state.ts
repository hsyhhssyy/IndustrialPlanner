import { makeAutoObservable } from "mobx";

import type { SceneAttachmentReference } from "@/domain/document/scene-view-input";
import type { UiKey } from "@/shared/i18n";
import type { ClientPixelPoint } from "@/domain/shared/client-pixel";

export interface OverlapEntityMenuCandidate {
  readonly kind: "entity";
  readonly id: string;
  readonly entityId: string;
  readonly definitionId: string;
}

export interface OverlapAttachmentMenuCandidate {
  readonly kind: "attachment";
  readonly id: string;
  readonly reference: SceneAttachmentReference;
  readonly labelKey: UiKey;
  readonly iconPath: string;
}

export type OverlapMenuCandidate = OverlapEntityMenuCandidate | OverlapAttachmentMenuCandidate;

export interface OverlapEntityMenuOpenRequest {
  readonly position: ClientPixelPoint;
  readonly candidates: readonly OverlapMenuCandidate[];
  readonly onSelect: (candidate: OverlapMenuCandidate) => void;
  readonly onCancel?: () => void;
}

export class WorkbenchOverlapEntityMenuController {
  visible = false;
  position: ClientPixelPoint | null = null;
  candidates: OverlapMenuCandidate[] = [];

  _onSelect: ((candidate: OverlapMenuCandidate) => void) | null = null;
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

  public select(candidateId: string): void {
    if (!this.visible || !this.candidates.some((candidate) => candidate.id === candidateId)) {
      return;
    }

    const onSelect = this._onSelect;
    const candidate = this.candidates.find((entry) => entry.id === candidateId)!;
    this.clear();
    onSelect?.(candidate);
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
  candidates: readonly OverlapMenuCandidate[],
): OverlapMenuCandidate[] {
  const seen = new Set<string>();
  const deduped: OverlapMenuCandidate[] = [];

  for (const candidate of candidates) {
    if (seen.has(candidate.id)) {
      continue;
    }

    seen.add(candidate.id);
    deduped.push(candidate);
  }

  return deduped;
}
