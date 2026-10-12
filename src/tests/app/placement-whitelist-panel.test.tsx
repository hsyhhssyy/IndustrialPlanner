// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { runInAction } from "mobx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlacementPanel } from "@/app/shell/panels/placement-panel";
import { QuickPlacePopup } from "@/app/shell/quick-place/quick-place-popup";
import { LeftToolbar } from "@/app/shell/layout/left-toolbar";
import { createWorldDocument } from "@/domain/document/world-document";
import { createEditorHost, type EditorHost } from "@/editor/editor-host";
import { createAppTestWorkspace } from "../helpers/app-test-workspace";
import { createFakeIndexedDbFactory } from "../shared/fake-indexed-db";

const BASE_ID = "wuling_agricultural_land";

describe("白名单设备与变体面板", () => {
  let session: ReturnType<typeof createAppTestWorkspace>;
  let editor: EditorHost;
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
    session = createAppTestWorkspace();
    session.workspace.registry.entityDefinitions = session.workspace.registry.entityDefinitions
      .filter((definition) => ["furnance_1", "furnance_1_liquid"].includes(definition.id))
      .map((definition) => ({
        ...definition,
        placementWhitelist: definition.id === "furnance_1"
          ? [{ baseId: BASE_ID, areaIds: [BASE_ID] }, { baseId: "draft_box" }]
          : [{ baseId: BASE_ID, areaIds: ["wuling_yuanyuan_zhuang"] }],
      }));
    editor = createEditorHost(session.workspace);
    await editor.internalDocuments.ready();
    editor.internalDocument.setSnapshot(createWorldDocument({ baseId: BASE_ID }));
    runInAction(() => { session.app.internalState.settings.collapseDeviceModes = true; });
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
      editor.dispose(); session.app.dispose(); container.remove(); localStorage.clear(); vi.unstubAllGlobals();
    }
  });
  function renderPanel() { act(() => { root.render(<PlacementPanel appHost={session.app} />); }); }
  function changeBase(baseId: string) {
    act(() => { editor.internalDocument.setSnapshot(createWorldDocument({ baseId })); });
  }

  it("主区域或任一子区域可用即保留型号，多型号保留折叠菜单", () => {
    renderPanel();
    expect(container.querySelectorAll(".placement-device-button")).toHaveLength(1);
    expect(container.querySelectorAll(".placement-entity-variant-trigger")).toHaveLength(1);
    expect(container.querySelector("[data-ui-button-id='placement-furnance_1']")).not.toBeNull();
  });
  it("过滤后只剩一个型号时隐藏菜单、变体图标与尾部占位，历史选择仍保留", () => {
    runInAction(() => { session.app.internalState.workbench.selectedPlacementVariantByCraftGroup = { furnance_1: "liquid" }; });
    changeBase("draft_box"); renderPanel();
    expect(container.querySelectorAll(".placement-device-button")).toHaveLength(1);
    expect(container.querySelector("[data-ui-button-id='placement-furnance_1']")).not.toBeNull();
    expect(container.querySelector(".placement-entity-variant-trigger")).toBeNull();
    expect(container.querySelector("[data-machine-mode-icon]")).toBeNull();
    expect(container.querySelector(".has-entity-variant")).toBeNull();
    expect(session.app.state.workbench.selectedPlacementVariantByCraftGroup.furnance_1).toBe("liquid");
    changeBase(BASE_ID);
    expect(container.querySelector("[data-ui-button-id='placement-furnance_1_liquid']")).not.toBeNull();
  });
  it("全部型号不可用时隐藏设备与空分类", () => {
    changeBase("valley4_protocol_core"); renderPanel();
    expect(container.querySelectorAll(".placement-device-button")).toHaveLength(0);
    expect(container.textContent).not.toContain("基础生产");
  });
  it("主型号不可用时唯一子型号仍可显示，关闭折叠后也只显示可用型号", () => {
    session.workspace.registry.entityDefinitions = session.workspace.registry.entityDefinitions.map((definition) => ({
      ...definition, placementWhitelist: definition.id === "furnance_1" ? [] : [{ baseId: "draft_box" }],
    }));
    runInAction(() => { session.app.internalState.settings.collapseDeviceModes = false; });
    changeBase("draft_box"); renderPanel();
    expect(container.querySelectorAll(".placement-device-button")).toHaveLength(1);
    expect(container.querySelector("[data-ui-button-id='placement-furnance_1_liquid']")).not.toBeNull();
    expect(container.querySelector("[data-machine-mode-icon]")).toBeNull();
  });
  it("基地切换关闭菜单，切回不会恢复旧锚点打开状态", () => {
    renderPanel();
    const trigger = container.querySelector(".placement-entity-variant-trigger")!;
    act(() => { trigger.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 })); });
    expect(container.querySelector("[aria-expanded='true']")).not.toBeNull();
    changeBase("draft_box");
    expect(container.querySelector(".placement-entity-variant-trigger")).toBeNull();
    changeBase(BASE_ID);
    expect(container.querySelector("[aria-expanded='true']")).toBeNull();
  });
  it("显式切换面板恢复临时隐藏的左栏，按钮选中状态反映实际可见性", () => {
    session.app.internalActions.setActivePanel("placement");
    session.app.internalActions.setLeftDockSuppressed(true);
    act(() => { root.render(<LeftToolbar appHost={session.app} />); });
    const placement = container.querySelector("[aria-label='放置模式']")!;
    expect(placement.getAttribute("aria-pressed")).toBe("false");
    act(() => { placement.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(session.app.internalState.workbench.leftDockSuppressed).toBe(false);
    expect(session.app.state.workbench.leftDockOpen).toBe(true);
    expect(placement.getAttribute("aria-pressed")).toBe("true");
  });
  it("当前不可用收藏隐藏但保留槽位，切回恢复；唯一变体不显示徽标", () => {
    runInAction(() => {
      session.app.internalState.workbench.quickPlaceFavoriteEntityIds = ["furnance_1_liquid", "furnance_1"];
      session.app.internalState.runtime.quickPlace.visible = true;
      session.app.internalState.runtime.quickPlace.anchor = { x: 120, y: 80 };
    });
    changeBase("draft_box");
    act(() => { root.render(<QuickPlacePopup appHost={session.app} />); });
    expect(session.app.internalState.workbench.quickPlaceFavoriteEntityIds).toEqual(["furnance_1_liquid", "furnance_1"]);
    const slots = container.querySelectorAll(".quick-place-favorite-slot");
    expect(slots[0]?.classList.contains("is-empty")).toBe(true);
    expect(slots[1]?.classList.contains("is-empty")).toBe(false);
    expect(container.querySelector(".quick-place-variant-badge")).toBeNull();
    changeBase(BASE_ID);
    expect(container.querySelectorAll(".quick-place-favorite-slot")[0]?.classList.contains("is-empty")).toBe(false);
    expect(container.querySelector(".quick-place-variant-badge")).not.toBeNull();
  });
});
