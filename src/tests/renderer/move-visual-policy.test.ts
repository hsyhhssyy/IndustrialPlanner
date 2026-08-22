import { describe, expect, it } from "vitest";

import {
  isBatchMove,
  resolveBatchMoveHiddenRangeEntityIds,
  resolveStrongPortOverlayEntityIds,
  shouldUseGroupedPreviewVisuals,
} from "@/renderer/move-visual-policy";

describe("move visual policy", () => {
  it.each([
    { moveKind: "ordinary" as const, previewCount: 1, expected: false },
    { moveKind: "ordinary" as const, previewCount: 2, expected: false },
    { moveKind: "batch" as const, previewCount: 1, expected: true },
    { moveKind: "batch" as const, previewCount: 2, expected: true },
    { moveKind: null, previewCount: 1, expected: false },
    { moveKind: null, previewCount: 2, expected: true },
  ])(
    "resolves grouped preview visuals from move kind $moveKind and count $previewCount",
    ({ moveKind, previewCount, expected }) => {
      expect(shouldUseGroupedPreviewVisuals(moveKind, previewCount)).toBe(expected);
    },
  );

  it("hides every strong port overlay during a single-device batch move", () => {
    expect(isBatchMove("batch")).toBe(true);
    expect(resolveStrongPortOverlayEntityIds(
      "batch",
      ["preview-device"],
      ["selected-device"],
    )).toEqual(new Set());
  });

  it("keeps the preview device strong port overlay during an ordinary move", () => {
    expect(resolveStrongPortOverlayEntityIds(
      "ordinary",
      ["preview-device"],
      ["selected-device"],
    )).toEqual(new Set(["preview-device"]));
  });

  it("hides only original and draft entities that belong to a batch move", () => {
    expect(resolveBatchMoveHiddenRangeEntityIds(
      "batch",
      ["preview-power-pole", "preview-gas-device"],
      ["power-pole", "gas-device"],
    )).toEqual(new Set([
      "power-pole",
      "gas-device",
      "preview-power-pole",
      "preview-gas-device",
    ]));
  });

  it("does not hide range entities during an ordinary move", () => {
    expect(resolveBatchMoveHiddenRangeEntityIds(
      "ordinary",
      ["preview-power-pole"],
      ["power-pole"],
    )).toEqual(new Set());
  });
});
