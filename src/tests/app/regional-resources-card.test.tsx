import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RegionalResourcesCard } from "@/app/shell/panels/regional-resources-card";
import { createAppTestWorkspace } from "../helpers/app-test-workspace";
import { mountTestComponent } from "../helpers/react-test-dom";
import { createFakeIndexedDbFactory } from "../shared/fake-indexed-db";

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
});
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

it("固定无限资源独立于可编辑列表，清空地区资源后仍显示且不可编辑", async () => {
  const { app } = createAppTestWorkspace();
  const region = app.workspace.registry.baseDefinitions[0]!.tag;
  const view = await mountTestComponent(<RegionalResourcesCard appHost={app} regionTag={region} />);
  try {
    const fixed = [...view.container.querySelectorAll("span, div")].find(element =>
      element.textContent === "仓库固定无限供应")!.parentElement!;
    expect(fixed.textContent).toMatch(/清水\s*∞/);
    expect(fixed.textContent).toMatch(/沉积酸\s*∞/);
    expect(fixed.querySelectorAll("button, input")).toHaveLength(0);
    await act(async () => { app.regionalSettings.setRegionResources(region, []); });
    expect(app.regionalSettings.getRegionResources(region)).toEqual([]);
    expect(view.container.querySelectorAll('button[aria-label="移除资源"]')).toHaveLength(0);
    expect(fixed.isConnected).toBe(true);
    expect(fixed.textContent).toMatch(/清水\s*∞/);
  } finally { await view.unmount(); app.dispose(); }
});
