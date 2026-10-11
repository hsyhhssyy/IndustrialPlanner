import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { KeyboardShortcutSettingsDialog } from "@/app/shell/dialogs/keyboard-shortcut-settings-dialog";
import { createDefaultDialogStateForKey } from "@/app/state/state-impl";
import { createAppTestWorkspace } from "../helpers/app-test-workspace";
import { mountTestComponent } from "../helpers/react-test-dom";
import { createFakeIndexedDbFactory } from "../shared/fake-indexed-db";

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
});
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

it("快捷键设置显示全部 29 项、默认剪切绑定和五组固定顺序", async () => {
  const { app } = createAppTestWorkspace();
  const dialogState = { ...createDefaultDialogStateForKey("settings"), visible: true };
  const view = await mountTestComponent(<KeyboardShortcutSettingsDialog appHost={app} dialogState={dialogState} onClose={() => {}} />);
  try {
    expect(view.container.querySelectorAll('[data-shortcut-id][data-slot-index="0"]')).toHaveLength(29);
    expect(view.container.querySelector('[data-shortcut-id="shortcut-cut-selection"][data-slot-index="0"]')?.getAttribute("aria-label"))
      .toMatch(/剪切选区.*Ctrl\+X/);
    const groups = [...view.container.querySelectorAll("[data-shortcut-group]")];
    expect(groups.map(group => group.getAttribute("data-shortcut-group"))).toEqual([
      "quick-access", "placement", "operation", "viewport", "history",
    ]);
    expect(groups.map(group => group.querySelector("h2")?.textContent)).toEqual([
      "快速访问与面板", "放置入口", "当前操作与选区", "视口", "历史",
    ]);
    expect(groups.map(group => group.querySelectorAll(":scope > article").length)).toEqual([6, 7, 9, 5, 2]);
  } finally { await view.unmount(); app.dispose(); }
});
