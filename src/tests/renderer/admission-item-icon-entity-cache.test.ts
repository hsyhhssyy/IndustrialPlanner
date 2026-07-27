import { describe, expect, it } from "vitest";

import type { WorldEntity } from "@/domain/document/world-document";
import {
  createAdmissionItemIconEntityCache,
} from "@/renderer/scene/decorations/AdmissionItemIconEntityCache";

const ADMISSION_DEFINITION_IDS = new Set([
  "log_admission",
  "pipe_admission",
]);

describe("AdmissionItemIconEntityCache", () => {
  it("在同一 document 内随移动草稿出现、移动和取消而失效", () => {
    const cache = createAdmissionItemIconEntityCache();
    const documentSnapshot = {};
    const original = entity("admission", "log_admission", 0);
    const initial = cache.resolve({
      documentSnapshot,
      entities: [original],
      previewEntities: [],
      isAdmissionDefinition: (definitionId) => ADMISSION_DEFINITION_IDS.has(definitionId),
    });
    const draftAtFirstPosition = entity("move-draft:admission", "log_admission", 4);
    const whileMoving = cache.resolve({
      documentSnapshot,
      entities: [original, draftAtFirstPosition],
      previewEntities: [draftAtFirstPosition],
      isAdmissionDefinition: (definitionId) => ADMISSION_DEFINITION_IDS.has(definitionId),
    });
    const draftAtSecondPosition = entity("move-draft:admission", "log_admission", 8);
    const afterMoving = cache.resolve({
      documentSnapshot,
      entities: [original, draftAtSecondPosition],
      previewEntities: [draftAtSecondPosition],
      isAdmissionDefinition: (definitionId) => ADMISSION_DEFINITION_IDS.has(definitionId),
    });
    const afterCancel = cache.resolve({
      documentSnapshot,
      entities: [original],
      previewEntities: [],
      isAdmissionDefinition: (definitionId) => ADMISSION_DEFINITION_IDS.has(definitionId),
    });

    expect(initial).toEqual([original]);
    expect(whileMoving).toEqual([original, draftAtFirstPosition]);
    expect(afterMoving).toEqual([original, draftAtSecondPosition]);
    expect(afterCancel).toEqual([original]);
  });

  it("在 document 与 preview 都未变化时复用筛选结果", () => {
    const cache = createAdmissionItemIconEntityCache();
    const documentSnapshot = {};
    const admission = entity("admission", "log_admission", 0);
    const first = cache.resolve({
      documentSnapshot,
      entities: [admission],
      previewEntities: [],
      isAdmissionDefinition: (definitionId) => ADMISSION_DEFINITION_IDS.has(definitionId),
    });
    const second = cache.resolve({
      documentSnapshot,
      entities: [admission],
      previewEntities: [],
      isAdmissionDefinition: (definitionId) => ADMISSION_DEFINITION_IDS.has(definitionId),
    });

    expect(second).toBe(first);
  });
});

function entity(
  id: string,
  definitionId: string,
  x: number,
): WorldEntity {
  return {
    id,
    definitionId,
    position: { x, y: 0 },
    rotation: 0,
    config: {},
    tags: [],
  };
}
