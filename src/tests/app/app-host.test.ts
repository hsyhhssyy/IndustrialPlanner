import { describe, expect, it } from "vitest";

import { createAppHost } from "@/app/app-host";
import type { WorkspaceContract } from "@/domain/contract/workspace-contract";
import { createWorkspaceState } from "@/domain/state/workspace-state";
import { createRegistryContract } from "@/registry";

function createWorkspace(): WorkspaceContract {
  return {
    state: createWorkspaceState(),
    registry: createRegistryContract(),
    app: null,
    editor: null,
    render: null,
    simulation: null,
  };
}

describe("createAppHost", () => {
  it("initializes app settings locale and keeps readonly views in sync", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    expect(appHost.state.settings.locale).toBe("zh-CN");
    expect(appHost.internalState.settings.locale).toBe("zh-CN");
    expect(workspace.app?.state.settings.locale).toBe("zh-CN");

    appHost.internalState.settings.locale = "en-US";

    expect(appHost.state.settings.locale).toBe("en-US");
    expect(appHost.internalState.settings.locale).toBe("en-US");
    expect(workspace.app?.state.settings.locale).toBe("en-US");
  });

  it("translates arbitrary i18n keys through the current locale", () => {
    const workspace = createWorkspace();
    const appHost = createAppHost(workspace);

    expect(appHost.actions.translate("app.title")).toBe("终末地工业系统仿真器 Stage1");
    expect(appHost.actions.translate("workbench.leftRail.placement")).toBe("放置模式");
    expect(appHost.actions.translate("unknown.key")).toBe("unknown.key");

    appHost.internalState.settings.locale = "en-US";

    expect(appHost.actions.translate("app.title")).toBe("Industrial Planner Stage1");
    expect(appHost.actions.translate("workbench.leftRail.placement")).toBe("放置模式");
  });
});