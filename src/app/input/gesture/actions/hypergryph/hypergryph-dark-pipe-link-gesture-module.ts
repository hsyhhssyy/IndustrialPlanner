import type { AppHost } from "@/app/host/app-host";
import { DARK_PIPE_LINK_TOOL, isDarkPipeDefinitionId } from "@/shared/dark-pipe-link";

import type { GestureMappingModule } from "../types";
import { isHypergryphGestureEnabled } from "./hypergryph-mode-guard";

export function createHypergryphDarkPipeLinkGestureModule(): GestureMappingModule<AppHost> {
  return {
    id: "hypergryph-dark-pipe-link-gesture",
    priority: 130,
    when: isHypergryphGestureEnabled,
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

        if (context.appHost.state.toolInfo.darkPipeLink === null) {
          context.appHost.internalActions.setActiveTool("select");
        }
        return { status: "handled" };
      }

      if (context.appHost.internalState.activeTool !== DARK_PIPE_LINK_TOOL) {
        return { status: "ignored" };
      }

      const state = context.appHost.state.toolInfo.darkPipeLink;
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

      if (event.type === "key down" && event.code === "Escape") {
        exitDarkPipeLinkTool(context.appHost, state.returnTool);
        return { status: "handled" };
      }

      if (event.type === "mouse tap") {
        if (event.button === 2) {
          exitDarkPipeLinkTool(context.appHost, state.returnTool);
          return { status: "handled" };
        }
        if (event.button !== 0) {
          return { status: "ignored" };
        }

        return handleDarkPipeTargetTap(context.appHost, state.sourceEntityId, state.candidateEntityIds, event.pointerEntity?.id ?? null);
      }

      if (event.type === "touch tap") {
        return handleDarkPipeTargetTap(context.appHost, state.sourceEntityId, state.candidateEntityIds, event.pointerEntity?.id ?? null);
      }

      return { status: "ignored" };
    },
  };
}

function handleDarkPipeTargetTap(
  appHost: AppHost,
  sourceEntityId: string,
  candidateEntityIds: readonly string[],
  targetEntityId: string | null,
) {
  const state = appHost.state.toolInfo.darkPipeLink;
  if (state === null) {
    appHost.internalActions.setActiveTool("select");
    return { status: "handled" as const };
  }

  if (targetEntityId === null || !candidateEntityIds.includes(targetEntityId)) {
    return { status: "handled" as const };
  }

  const created = appHost.workspace.editor?.actions.createDarkPipeLink({
    sourceEntityId,
    targetEntityId,
  }) ?? false;

  if (created) {
    exitDarkPipeLinkTool(appHost, state.returnTool);
  }

  return { status: "handled" as const };
}

function exitDarkPipeLinkTool(
  appHost: AppHost,
  returnTool: AppHost["internalState"]["activeTool"],
): void {
  appHost.internalState.toolInfo.darkPipeLink = null;
  appHost.internalActions.setActiveTool(returnTool === DARK_PIPE_LINK_TOOL ? "select" : returnTool);
}
