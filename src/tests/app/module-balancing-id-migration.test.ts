import { describe, expect, it } from "vitest";

import {
  createModuleBalancingId,
  isLegacyModuleBalancingId,
  isModuleBalancingUuid,
} from "@/app/shell/module-balancing/module-balancing-model";

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("createModuleBalancingId", () => {
  it("returns a valid UUID v4", () => {
    const id = createModuleBalancingId();
    expect(UUID_V4_RE.test(id)).toBe(true);
  });

  it("returns unique IDs on repeated calls", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      ids.add(createModuleBalancingId());
    }

    expect(ids.size).toBe(100);
  });
});

describe("isLegacyModuleBalancingId", () => {
  it("detects legacy canvas ID", () => {
    expect(isLegacyModuleBalancingId("canvas-lrv7abc-3kx9w2")).toBe(true);
  });

  it("detects legacy custom-module ID", () => {
    expect(isLegacyModuleBalancingId("custom-module-lrv7abc-a1b2c3")).toBe(true);
  });

  it("detects legacy stage ID", () => {
    expect(isLegacyModuleBalancingId("stage-lrv7abc-x9y8z7")).toBe(true);
  });

  it("detects legacy module-folder ID", () => {
    expect(isLegacyModuleBalancingId("module-folder-lrv7abc-d4e5f6")).toBe(true);
  });

  it("detects legacy canvas-folder ID", () => {
    expect(isLegacyModuleBalancingId("canvas-folder-abcd123-1234567")).toBe(true);
  });

  it("rejects UUID v4", () => {
    expect(isLegacyModuleBalancingId("550e8400-e29b-41d4-a716-446655440000")).toBe(false);
  });

  it("rejects system-recipe ID", () => {
    expect(isLegacyModuleBalancingId("smelt_plate")).toBe(false);
  });

  it("rejects recommended module ID", () => {
    expect(isLegacyModuleBalancingId("recommended:starter")).toBe(false);
  });
});

describe("isModuleBalancingUuid", () => {
  it("accepts valid UUID v4", () => {
    expect(isModuleBalancingUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isModuleBalancingUuid(createModuleBalancingId())).toBe(true);
  });

  it("rejects legacy ID", () => {
    expect(isModuleBalancingUuid("canvas-abc123-def456")).toBe(false);
  });

  it("rejects system-recipe ID", () => {
    expect(isModuleBalancingUuid("smelt_plate")).toBe(false);
  });
});
