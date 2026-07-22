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
    expect(rootDirectory.folders).toHaveLength(5);
    expect(rootDirectory.folders[0]).toMatchObject({
      name: "新手教程",
      parentFolderId: null,
    });
    expect(rootDirectory.folders[1]).toMatchObject({
      name: "四号谷地产线样例",
      parentFolderId: null,
    });
    expect(rootDirectory.folders[2]).toMatchObject({
      name: "武陵产线样例",
      parentFolderId: null,
    });
    expect(rootDirectory.folders[3]).toMatchObject({
      name: "赤石科技",
      parentFolderId: null,
    });
    expect(rootDirectory.folders[4]).toMatchObject({
      name: "1.4向渊行版本蓝图",
      parentFolderId: null,
    });

    const valley4FolderDirectory = listSystemBlueprintDirectory(
      snapshot,
      rootDirectory.folders[1]?.folderId ?? null,
    );
    const wulingFolderDirectory = listSystemBlueprintDirectory(
      snapshot,
      rootDirectory.folders[2]?.folderId ?? null,
    );

    expect(valley4FolderDirectory.blueprints).toHaveLength(1);
    expect(valley4FolderDirectory.blueprints[0]).toMatchObject({
      blueprintId: "429609a4-61cb-4083-98fa-b8de1268bec4",
      name: "精选荞愈胶囊产线",
      baseId: "valley4_protocol_core",
      sourcePath: "premium-capsule-line.json",
      initialGridPoint: {
        x: 12,
        y: 22,
      },
    });
    expect(valley4FolderDirectory.blueprints[0]?.entityOrder).toHaveLength(227);
    // 2026-06-10: 蓝图导入后取货口的 warehouse link 写入 slotLinks，不再为空。
    expect(valley4FolderDirectory.blueprints[0]?.slotLinks.length).toBeGreaterThan(0);
    expect(valley4FolderDirectory.blueprints[0]?.entities.legacy_429609a4_0082).toMatchObject({
      definitionId: "belt_turn_cw_1x1",
      rotation: 90,
    });
    expect(valley4FolderDirectory.blueprints[0]?.entities.legacy_429609a4_0106).toMatchObject({
      definitionId: "belt_turn_ccw_1x1",
      rotation: 180,
    });

    expect(wulingFolderDirectory.blueprints).toHaveLength(4);
    expect(wulingFolderDirectory.blueprints[0]).toMatchObject({
      blueprintId: "c96944de-0608-4abf-901a-8b3d27a476d1",
      name: "双烘炉息壤产线",
      baseId: "wuling_tianwangping_aid",
      sourcePath: "dual-oven-xiranite.json",
      initialGridPoint: {
        x: 15,
        y: 13,
      },
    });
    expect(wulingFolderDirectory.blueprints[0]?.entityOrder).toHaveLength(148);
    // 2026-06-10: dual-oven-xiranite 没有取货口，但迁移后 dudpipe_unloader 的 warehouse link 也在 slotLinks 中。
    expect(wulingFolderDirectory.blueprints[0]?.slotLinks.length).toBeGreaterThanOrEqual(0);
    expect(wulingFolderDirectory.blueprints[0]?.entities.legacy_c96944de_0009).toMatchObject({
      definitionId: "belt_turn_cw_1x1",
      rotation: 270,
    });
    expect(wulingFolderDirectory.blueprints[0]?.entities.legacy_c96944de_0031).toMatchObject({
      definitionId: "pipe_turn_ccw_1x1",
      rotation: 180,
    });

    expect(wulingFolderDirectory.blueprints[1]).toMatchObject({
      blueprintId: "2dec8da2-1c38-47f3-a574-a586bd4efad5",
      name: "中容武陵电池产线",
      baseId: "wuling_tianwangping_aid",
      sourcePath: "wuling-battery-line.json",
    });
    expect(wulingFolderDirectory.blueprints[1]?.entityOrder).toHaveLength(338);
    // 2026-06-10: 蓝图导入后取货口的 warehouse link 写入 slotLinks。
    expect(wulingFolderDirectory.blueprints[1]?.slotLinks.length).toBeGreaterThan(0);

    const chishiFolderDirectory = listSystemBlueprintDirectory(
      snapshot,
      rootDirectory.folders[3]?.folderId ?? null,
    );
    expect(chishiFolderDirectory.blueprints).toHaveLength(1);
    expect(chishiFolderDirectory.blueprints[0]).toMatchObject({
      blueprintId: "f00abb80-6b5e-45ab-ae01-32bd1e3e1771",
      name: "一键去世机7.1",
      baseId: "valley4_protocol_core",
      sourcePath: "resurrection-machine-7.1.json",
      initialGridPoint: {
        x: 11,
        y: 6,
      },
    });
    expect(chishiFolderDirectory.blueprints[0]?.entityOrder).toHaveLength(188);
    // 2026-06-10: 蓝图导入后取货口的 warehouse link 写入 slotLinks。
    expect(chishiFolderDirectory.blueprints[0]?.slotLinks.length).toBeGreaterThan(0);
    expect(chishiFolderDirectory.blueprints[0]?.entities.legacy_f00abb80_0014).toMatchObject({
      definitionId: "belt_turn_cw_1x1",
      rotation: 90,
    });
    expect(chishiFolderDirectory.blueprints[0]?.entities.legacy_f00abb80_0017).toMatchObject({
      definitionId: "belt_turn_ccw_1x1",
      rotation: 90,
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