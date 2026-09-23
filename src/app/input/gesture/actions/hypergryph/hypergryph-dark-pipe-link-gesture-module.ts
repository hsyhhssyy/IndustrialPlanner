import type { AppHost } from "@/app/host/app-host";
import {
  DARK_PIPE_LINK_TOOL,
  createRegionalDarkPipeLink,
  findDarkPipeSlotLinkForEntity,
  isDarkPipeDefinitionId,
  resolveDarkPipeRole,
} from "@/shared/dark-pipe-link";

import type { GestureMappingModule } from "../types";
// AI-REMOVED 2026-09-10:
// Reason: 操作模式总开关已废弃，不再保留关闭分支
// Trigger: 用户要求彻底移除 hypergryphOperationMode。
// Evidence: 总开关入口已隐藏；手势路由器无 when 时默认启用。
// Replacement: gesture-action-router.ts 的默认启用语义
// Risk: 历史 false 设置统一使用当前操作行为。
// Human Review: Required
//
// Original code:
// import { isHypergryphGestureEnabled } from "./hypergryph-mode-guard";

export function createHypergryphDarkPipeLinkGestureModule(): GestureMappingModule<AppHost> {
  return {
    id: "hypergryph-dark-pipe-link-gesture",
    priority: 130,
    // AI-REMOVED 2026-09-10:
    // Reason: 操作模式总开关已废弃，不再保留关闭分支
    // Trigger: 用户要求彻底移除 hypergryphOperationMode。
    // Evidence: 总开关入口已隐藏；手势路由器无 when 时默认启用。
    // Replacement: gesture-action-router.ts 的默认启用语义
    // Risk: 历史 false 设置统一使用当前操作行为。
    // Human Review: Required
    //
    // Original code:
    // when: isHypergryphGestureEnabled,
    shortcutRoutes: [{
      id: "dark-pipe-link.cancel",
      actionId: "fixed.dark-pipe-link.cancel",
      binding: { kind: "fixed", value: "Esc" },
      scope: { inputLayers: ["canvas"], activeTools: ["dark-pipe-link"] },
      triggerPolicy: { kind: "exact" },
      handle(_event, context) {
        const state = context.appHost.internalState.toolInfo.darkPipeLink;
        if (state === null) return { status: "ignored" };
        exitDarkPipeLinkTool(context.appHost, state.returnTool);
        return { status: "handled" };
      },
    }],
    handle(event, context) {
      if (event.type === "on-exit-active-tool") {
        if (event.from !== DARK_PIPE_LINK_TOOL) {
          return { status: "ignored" };
        }

        context.appHost.internalState.toolInfo.darkPipeLink = null;
        return { status: "handled" };
      }

      if (event.type === "on-enter-active-tool") {
        if (event.to !== DARK_PIPE_LINK_TOOL) {
          return { status: "ignored" };
        }

        if (context.appHost.internalState.toolInfo.darkPipeLink === null) {
          context.appHost.internalActions.setActiveTool("select");
        }
        return { status: "handled" };
      }

      if (context.appHost.internalState.activeTool !== DARK_PIPE_LINK_TOOL) {
        return { status: "ignored" };
      }

      const state = context.appHost.internalState.toolInfo.darkPipeLink;
      if (state === null) {
        context.appHost.internalActions.setActiveTool("select");
        return { status: "handled" };
      }

      if (event.type === "mouse move") {
        const editor = context.workspace.editor;
        if (editor === null) return { status: "ignored" };

        const entity = editor.queries.findEntityAtClientPixelPoint(event.position);
        if (entity !== null && isDarkPipeDefinitionId(entity.definitionId)) {
          editor.actions.setHoverPoint(event.position);
        } else {
          editor.actions.clearHoverPoint();
        }
        return { status: "handled", consume: false };
      }

      // AI-REMOVED 2026-08-30:
      // Reason: 暗管取消 Escape 已迁入固定 Shortcut Route。
      // Trigger: ST2-RQ-020 固定 Action 作用域统一。
      // Evidence: dark-pipe-link.cancel 仅覆盖 canvas/dark-pipe-link。
      // Replacement: shortcutRoutes[dark-pipe-link.cancel] in this module
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // if (event.type === "key down" && event.code === "Escape") {
      //   exitDarkPipeLinkTool(context.appHost, state.returnTool);
      //   return { status: "handled" };
      // }

      if (event.type === "mouse tap") {
        if (event.button === 2) {
          exitDarkPipeLinkTool(context.appHost, state.returnTool);
          return { status: "handled" };
        }
        if (event.button !== 0) {
          return { status: "ignored" };
        }

        return handleDarkPipeTargetTap(context.appHost, event.pointerEntity?.id ?? null);
      }

      if (event.type === "touch tap") {
        return handleDarkPipeTargetTap(context.appHost, event.pointerEntity?.id ?? null);
      }

      return { status: "ignored" };
    },
  };
}

function handleDarkPipeTargetTap(
  appHost: AppHost,
  targetEntityId: string | null,
) {
  // AI-REMOVED 2026-09-23:
  // Reason: 原函数只接受当前画布候选 ID，无法在切换基地后连接远端暗管。
  // Trigger: 用户要求同一按钮在当前画布和其他同区域基地画布均可选点。
  // Evidence: candidateEntityIds 原先仅由源基地文档生成；切换基地后目标不在列表中。
  // Replacement: 下方按 sourceBaseId 分流的本地与跨基地点击处理。
  // Risk: Low
  // Human Review: Required
  // Original code:
  // function handleDarkPipeTargetTap(
  //   appHost: AppHost,
  //   sourceEntityId: string,
  //   candidateEntityIds: readonly string[],
  //   targetEntityId: string | null,
  // ) {
  //   const state = appHost.state.toolInfo.darkPipeLink;
  //   if (state === null) {
  //     appHost.internalActions.setActiveTool("select");
  //     return { status: "handled" as const };
  //   }
  //   if (targetEntityId === null || !candidateEntityIds.includes(targetEntityId)) {
  //     return { status: "handled" as const };
  //   }
  //   const created = appHost.workspace.editor?.actions.createDarkPipeLink({
  //     sourceEntityId,
  //     targetEntityId,
  //   }) ?? false;
  //   if (created) {
  //     exitDarkPipeLinkTool(appHost, state.returnTool);
  //   }
  //   return { status: "handled" as const };
  // }
  const state = appHost.internalState.toolInfo.darkPipeLink;
  if (state === null) {
    appHost.internalActions.setActiveTool("select");
    return { status: "handled" as const };
  }

  const editor = appHost.workspace.editor;
  if (editor === null || targetEntityId === null) {
    return { status: "handled" as const };
  }
  const document = editor.document.getSnapshot();

  if (document.baseId === state.sourceBaseId) {
    if (!state.candidateEntityIds.includes(targetEntityId)) {
      return { status: "handled" as const };
    }
    const created = editor.actions.createDarkPipeLink({
      sourceEntityId: state.sourceEntityId,
      targetEntityId,
    });
    if (created) {
      exitDarkPipeLinkTool(appHost, state.returnTool);
    }
    return { status: "handled" as const };
  }

  if (
    !appHost.state.settings.regionalMultiBaseEnabled
    || appHost.workspace.simulation?.engineKind !== "dense-v2"
  ) {
    return { status: "handled" as const };
  }

  const sourceBase = appHost.workspace.registry.baseDefinitions.find(
    (base) => base.id === state.sourceBaseId,
  );
  const targetBase = appHost.workspace.registry.baseDefinitions.find(
    (base) => base.id === document.baseId,
  );
  if (sourceBase === undefined || targetBase === undefined || sourceBase.tag !== targetBase.tag) {
    exitDarkPipeLinkTool(appHost, state.returnTool);
    return { status: "handled" as const };
  }

  const targetEntity = document.entities[targetEntityId];
  const targetEndpoint = { baseId: document.baseId, entityId: targetEntityId };
  if (
    targetEntity === undefined
    || resolveDarkPipeRole(targetEntity.definitionId) !== (state.sourceRole === "inlet" ? "outlet" : "inlet")
    || findDarkPipeSlotLinkForEntity(document, targetEntityId) !== null
    || appHost.regionalSettings.findDarkPipeLink(targetEndpoint) !== null
  ) {
    return { status: "handled" as const };
  }

  void editor.queries.readLatestBaseDocuments([state.sourceBaseId]).then(([sourceDocument]) => {
    if (appHost.internalState.toolInfo.darkPipeLink !== state) return;
    const sourceEntity = sourceDocument?.entities[state.sourceEntityId];
    const sourceEndpoint = { baseId: state.sourceBaseId, entityId: state.sourceEntityId };
    if (
      sourceDocument === undefined
      || sourceEntity === undefined
      || resolveDarkPipeRole(sourceEntity.definitionId) !== state.sourceRole
      || findDarkPipeSlotLinkForEntity(sourceDocument, state.sourceEntityId) !== null
      || appHost.regionalSettings.findDarkPipeLink(sourceEndpoint) !== null
      || editor.document.getSnapshot().baseId !== targetEndpoint.baseId
      || resolveDarkPipeRole(editor.document.getSnapshot().entities[targetEntityId]?.definitionId ?? "")
        !== (state.sourceRole === "inlet" ? "outlet" : "inlet")
      || findDarkPipeSlotLinkForEntity(editor.document.getSnapshot(), targetEntityId) !== null
      || appHost.regionalSettings.findDarkPipeLink(targetEndpoint) !== null
    ) return;

    const inlet = state.sourceRole === "inlet" ? sourceEndpoint : targetEndpoint;
    const outlet = state.sourceRole === "outlet" ? sourceEndpoint : targetEndpoint;
    if (appHost.regionalSettings.addDarkPipeLink(createRegionalDarkPipeLink({ inlet, outlet }))) {
      exitDarkPipeLinkTool(appHost, state.returnTool);
    }
  }).catch(() => undefined);

  return { status: "handled" as const };
}

function exitDarkPipeLinkTool(
  appHost: AppHost,
  returnTool: AppHost["internalState"]["activeTool"],
): void {
  appHost.internalState.toolInfo.darkPipeLink = null;
  appHost.internalActions.setActiveTool(returnTool === DARK_PIPE_LINK_TOOL ? "select" : returnTool);
}
