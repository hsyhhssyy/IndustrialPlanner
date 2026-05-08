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
  it("loads the migrated premium capsule system blueprint from public assets", async () => {
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

    expect(sampleFolderDirectory.blueprints).toHaveLength(1);
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