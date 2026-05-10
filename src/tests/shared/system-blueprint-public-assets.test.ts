import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  listSystemBlueprintDirectory,
  readSystemBlueprintLibrary,
} from "@/shared/blueprints/system-blueprint-library";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("system-blueprint public assets", () => {
  it("loads the migrated system blueprints from public assets", async () => {
    vi.stubGlobal("fetch", createPublicAssetFetch());

    const snapshot = await readSystemBlueprintLibrary();
    const rootDirectory = listSystemBlueprintDirectory(snapshot, null);

    expect(snapshot.version).toBe("v1.3.0");
    expect(rootDirectory.folders).toHaveLength(1);
    expect(rootDirectory.folders[0]).toMatchObject({
      name: "产线样例",
      parentFolderId: null,
    });

    const sampleFolderDirectory = listSystemBlueprintDirectory(
      snapshot,
      rootDirectory.folders[0]?.folderId ?? null,
    );

    expect(sampleFolderDirectory.blueprints).toHaveLength(2);
    expect(sampleFolderDirectory.blueprints[0]).toMatchObject({
      blueprintId: "429609a4-61cb-4083-98fa-b8de1268bec4",
      name: "精选荞愈胶囊产线",
      baseId: "valley4_protocol_core",
      sourcePath: "premium-capsule-line.json",
      initialGridPoint: {
        x: 12,
        y: 22,
      },
    });
    expect(sampleFolderDirectory.blueprints[0]?.entityOrder).toHaveLength(227);
    expect(sampleFolderDirectory.blueprints[0]?.slotLinks).toEqual([]);
    expect(sampleFolderDirectory.blueprints[0]?.entities.premium_capsule_line_0082).toMatchObject({
      definitionId: "belt_turn_cw_1x1",
      rotation: 90,
    });
    expect(sampleFolderDirectory.blueprints[0]?.entities.premium_capsule_line_0106).toMatchObject({
      definitionId: "belt_turn_ccw_1x1",
      rotation: 180,
    });

    expect(sampleFolderDirectory.blueprints[1]).toMatchObject({
      blueprintId: "c96944de-0608-4abf-901a-8b3d27a476d1",
      name: "双烘炉息壤产线",
      baseId: "wuling_tianwangping_aid",
      sourcePath: "dual-oven-xiranite.json",
      initialGridPoint: {
        x: 15,
        y: 13,
      },
    });
    expect(sampleFolderDirectory.blueprints[1]?.entityOrder).toHaveLength(148);
    expect(sampleFolderDirectory.blueprints[1]?.slotLinks).toEqual([]);
    expect(sampleFolderDirectory.blueprints[1]?.entities.dual_oven_xiranite_0009).toMatchObject({
      definitionId: "belt_turn_cw_1x1",
      rotation: 270,
    });
    expect(sampleFolderDirectory.blueprints[1]?.entities.dual_oven_xiranite_0031).toMatchObject({
      definitionId: "pipe_turn_ccw_1x1",
      rotation: 180,
    });
  });
});

function createPublicAssetFetch() {
  return vi.fn(async (input: string | URL | Request) => {
    const pathname = normalizeFetchPath(input);
    const assetPath = resolve(process.cwd(), "public", pathname.replace(/^\//, ""));

    if (!existsSync(assetPath)) {
      return {
        ok: false,
        status: 404,
        json: async () => null,
      } as Response;
    }

    return {
      ok: true,
      status: 200,
      json: async () => JSON.parse(readFileSync(assetPath, "utf8")),
    } as Response;
  });
}

function normalizeFetchPath(input: string | URL | Request): string {
  if (typeof input === "string") {
    return new URL(input, "https://placeholder.local").pathname;
  }

  if (input instanceof URL) {
    return input.pathname;
  }

  return new URL(input.url, "https://placeholder.local").pathname;
}