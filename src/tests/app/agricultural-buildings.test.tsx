// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlacementPanel } from "@/app/shell/panels/placement-panel";
import { ENTITY_UI_GROUP_ORDER } from "@/app/shell/encyclopedia/encyclopedia-browser";
import { TOOLBOX_WIKI_ENTITY_GROUP_CATEGORY_IDS } from "@/app/state/state-impl";
import { canPlaceEntityDefinitionInCurrentBase } from "@/app/placement-zone-availability";
import { createWorldDocument } from "@/domain/document/world-document";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import { createEditorHost, type EditorHost } from "@/editor/editor-host";
import { createAppTestWorkspace } from "../helpers/app-test-workspace";
import { createFakeIndexedDbFactory } from "../shared/fake-indexed-db";

const BASE_ID = "wuling_agricultural_land";

describe("农业建筑分类与普通田块摆放", () => {
  let session: ReturnType<typeof createAppTestWorkspace>;
  let editor: EditorHost;
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
    session = createAppTestWorkspace();
    editor = createEditorHost(session.workspace);
    await editor.internalDocuments.ready();
    editor.internalDocument.setSnapshot(createWorldDocument({ baseId: BASE_ID }));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    act(() => { root.unmount(); });
    try {
      await editor.internalHistory.flush();
      await editor.internalDocuments.flush();
      await editor.internalDocuments.settleMaintenance();
    } finally {
      editor.dispose();
      session.app.dispose();
      container.remove();
      localStorage.clear();
      vi.unstubAllGlobals();
    }
  });

  it("放置面板和百科分类收录农业建筑，仅在农牧用地展示二十二种田块与洒水机", () => {
    expect(ENTITY_UI_GROUP_ORDER).toContain("agriculture");
    expect(TOOLBOX_WIKI_ENTITY_GROUP_CATEGORY_IDS).toContain("agriculture");
    act(() => { root.render(<PlacementPanel appHost={session.app} />); });
    const section = [...container.querySelectorAll("section")]
      .find((candidate) => candidate.querySelector("h3")?.textContent === "农业建筑")!;
    expect(section).toBeDefined();
    // AI-CORRECTION 2026-10-15: 缘缘庄新增十二种田块，与既有十种田块及洒水机共同展示。
    expect(section.querySelectorAll(".placement-device-button")).toHaveLength(23);
    expect(section.querySelector("[data-ui-button-id='placement-squirter_1']")).not.toBeNull();
    expect(section.querySelector(".placement-panel-group-shortcut")).toBeNull();
    for (const base of session.workspace.registry.baseDefinitions.filter((candidate) => candidate.id !== BASE_ID)) {
      act(() => { editor.internalDocument.setSnapshot(createWorldDocument({ baseId: base.id })); });
      expect(container.textContent).not.toContain("农业建筑");
      expect(container.querySelector("[data-ui-button-id='placement-soil_grass_1']")).toBeNull();
      expect(container.querySelector("[data-ui-button-id='placement-squirter_1']")).toBeNull();
    }
  });

  it("十种田块均能实际放入主区域与缘缘庄，其他所有地图均拒绝摆放", () => {
    // AI-CORRECTION 2026-10-13: 分类新增洒水机，保留十种田块原有摆放断言。
    // AI-CORRECTION 2026-10-15: 新食材田块仅限缘缘庄，主区域权限由下方独立用例验证。
    const plots = session.workspace.registry.entityDefinitions.filter((definition) => definition.id.startsWith("soil_") && !definition.id.startsWith("soil_corp_"));
    expect(plots).toHaveLength(10);
    for (const [index, definition] of plots.entries()) {
      for (const originX of [0, 104]) {
        editor.actions.createSinglePlacementDraft(definition.id, {
          x: originX + 2 + index % 5 * 4, y: 4 + Math.floor(index / 5) * 4,
        });
        expect(editor.actions.applyPlacementDraft(), `${definition.id} at ${originX}`).toBe(true);
      }
    }
    expect(editor.document.getSnapshot().entityOrder).toHaveLength(20);
    for (const base of session.workspace.registry.baseDefinitions.filter((candidate) => candidate.id !== BASE_ID)) {
      editor.internalDocument.setSnapshot(createWorldDocument({ baseId: base.id }));
      for (const definition of plots) {
        expect(canPlaceEntityDefinitionInCurrentBase(session.app, definition)).toBe(false);
        editor.actions.createSinglePlacementDraft(definition.id, { x: 10, y: 10 });
        expect(editor.actions.applyPlacementDraft(), `${definition.id} in ${base.id}`).toBe(false);
        editor.actions.cancelPlacementDraft();
      }
    }
  });

  it("十二种新田块在缘缘庄可以实际摆放，在农业主区域拒绝摆放", () => {
    const plots = session.workspace.registry.entityDefinitions.filter(definition => definition.id.startsWith("soil_corp_"));
    expect(plots).toHaveLength(12);
    for (const [index, definition] of plots.entries()) {
      const offset = { x: 2 + index % 4 * 5, y: 2 + Math.floor(index / 4) * 5 };
      editor.actions.createSinglePlacementDraft(definition.id, offset);
      const previewId = editor.state.collections[EntityCollectionType.preview][0]!;
      expect(editor.queries.getEntityPlacementValidation(previewId).canPlace).toBe(false);
      expect(editor.actions.applyPlacementDraft()).toBe(false);
      editor.actions.cancelPlacementDraft();
      editor.actions.createSinglePlacementDraft(definition.id, { x: 104 + offset.x, y: offset.y });
      expect(editor.actions.applyPlacementDraft(), definition.id).toBe(true);
    }
    expect(editor.document.getSnapshot().entityOrder).toHaveLength(12);
  });

  it("洒水机能放入主区域与缘缘庄，其他所有地图均拒绝摆放", () => {
    const definition = session.workspace.registry.queries.findEntityDefinition("squirter_1")!;
    expect(canPlaceEntityDefinitionInCurrentBase(session.app, definition)).toBe(true);
    for (const x of [10, 114]) {
      editor.actions.createSinglePlacementDraft(definition.id, { x, y: 10 });
      const id = editor.state.collections[EntityCollectionType.preview][0]!;
      expect(editor.queries.getEntityPlacementValidation(id).canPlace).toBe(true);
      expect(editor.actions.applyPlacementDraft()).toBe(true);
    }
    expect(editor.document.getSnapshot().entityOrder).toHaveLength(2);
    for (const base of session.workspace.registry.baseDefinitions.filter((candidate) => candidate.id !== BASE_ID)) {
      editor.internalDocument.setSnapshot(createWorldDocument({ baseId: base.id }));
      expect(canPlaceEntityDefinitionInCurrentBase(session.app, definition)).toBe(false);
      editor.actions.createSinglePlacementDraft(definition.id, { x: 10, y: 10 });
      expect(editor.actions.applyPlacementDraft(), `${definition.id} in ${base.id}`).toBe(false);
      editor.actions.cancelPlacementDraft();
    }
  });

  it("白名单保留地图外围的完整占地边界，重叠沿用非法标记", () => {
    editor.actions.createSinglePlacementDraft("soil_grass_1", { x: 10, y: 10 });
    expect(editor.actions.applyPlacementDraft()).toBe(true);
    for (const position of [
      { x: 63, y: 10 }, { x: 160, y: 10 }, { x: 70, y: 10 },
      { x: -20, y: 10 }, { x: 0, y: -20 },
    ]) {
      editor.actions.createSinglePlacementDraft("soil_grass_2", position);
      const id = editor.state.collections[EntityCollectionType.preview][0]!;
      expect(editor.queries.getEntityPlacementValidation(id).canPlace).toBe(false);
      expect(editor.actions.applyPlacementDraft()).toBe(false);
      editor.actions.cancelPlacementDraft();
    }
    editor.actions.createSinglePlacementDraft("soil_grass_2", { x: 10, y: 10 });
    const overlapId = editor.state.collections[EntityCollectionType.preview][0]!;
    expect(editor.queries.getEntityPlacementValidation(overlapId).reasons.map((reason) => reason.code)).toContain("overlap");
    expect(editor.actions.applyPlacementDraft()).toBe(true);
    const committedOverlap = Object.values(editor.document.getSnapshot().entities)
      .find((entity) => entity.definitionId === "soil_grass_2")!;
    expect(editor.state.collections[EntityCollectionType.invalidPlacement].contains(committedOverlap.id)).toBe(true);
    editor.actions.createSinglePlacementDraft("soil_grass_2", { x: 40, y: 40 });
    expect(editor.actions.applyPlacementDraft()).toBe(true);
    editor.actions.createSinglePlacementDraft("soil_grass_2", { x: 138, y: 34 });
    expect(editor.actions.applyPlacementDraft()).toBe(true);
  });
});
