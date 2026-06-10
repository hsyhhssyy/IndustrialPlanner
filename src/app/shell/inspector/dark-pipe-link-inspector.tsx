import LucideLink2 from "~icons/lucide/link-2";
import LucideUnlink2 from "~icons/lucide/unlink-2";
import { runInAction } from "mobx";

import type { AppHost } from "@/app/host/app-host";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import {
  DARK_PIPE_LINK_TOOL,
  findDarkPipeSlotLinkForEntity,
  listDarkPipeLinkCandidateEntityIds,
  resolveDarkPipeLinkedEntityId,
  resolveDarkPipeRole,
} from "@/shared/dark-pipe-link";
import { InspectorCollapsiblePanel } from "@/app/shell/inspector/inspector-collapsible-panel";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

export function DarkPipeLinkInspector({
  appHost,
  entity,
  definition,
}: {
  appHost: AppHost;
  entity: WorldEntity;
  definition: EntityDefinition;
}) {
  const editor = appHost.workspace.editor;
  const documentSnapshot = editor?.document?.getSnapshot() ?? null;
  const darkPipeToolState = appHost.internalState.toolInfo;
  const role = resolveDarkPipeRole(definition.id);
  const currentLink = documentSnapshot === null ? null : findDarkPipeSlotLinkForEntity(documentSnapshot, entity.id);
  const linkedEntityId = documentSnapshot === null ? null : resolveDarkPipeLinkedEntityId(documentSnapshot, entity.id);
  const candidates = documentSnapshot === null
    ? []
    : listDarkPipeLinkCandidateEntityIds({
      document: documentSnapshot,
      sourceEntity: entity,
    });
  const selectingState = appHost.state.toolInfo.darkPipeLink;
  const isSelectingThisEntity = appHost.state.activeTool === DARK_PIPE_LINK_TOOL
    && selectingState?.sourceEntityId === entity.id;

  const canCreate = editor !== null
    && documentSnapshot !== null
    && role !== null
    && currentLink === null
    && candidates.length > 0;

  const startSelection = () => {
    if (!canCreate || role === null || documentSnapshot === null) {
      return;
    }

    const returnTool = appHost.state.activeTool === DARK_PIPE_LINK_TOOL
      ? "select"
      : appHost.state.activeTool;
    runInAction(() => {
      darkPipeToolState.darkPipeLink = {
        sourceEntityId: entity.id,
        sourceRole: role,
        candidateEntityIds: candidates,
        returnTool,
      };
    });
    appHost.internalActions.setActiveTool(DARK_PIPE_LINK_TOOL);
    appHost.internalActions.closeDialog("inspector");
  };

  const cancelSelection = () => {
    const returnTool = selectingState?.returnTool ?? "select";
    runInAction(() => {
      darkPipeToolState.darkPipeLink = null;
    });
    appHost.internalActions.setActiveTool(returnTool === DARK_PIPE_LINK_TOOL ? "select" : returnTool);
  };

  const removeLink = () => {
    if (editor === null || currentLink === null) {
      return;
    }

    editor.actions.removeDarkPipeLink(entity.id);
    if (isSelectingThisEntity) {
      cancelSelection();
    }
  };

  const buttonLabel = currentLink !== null
    ? "断开链接"
    : isSelectingThisEntity
      ? "取消选择"
      : "创建链接";
  const linkedLabel = linkedEntityId === null ? "未链接" : `已链接 ${linkedEntityId}`;

  return (
    <InspectorCollapsiblePanel
      className="dark-pipe-link-inspector"
      dataInspectorKey="dark-pipe-link"
      title="暗管链接"
    >
      <div
        className={cm(styles, "dark-pipe-link-row")}
        data-dark-pipe-link-state={currentLink === null ? "unlinked" : "linked"}
      >
        <span className={cm(styles, "dark-pipe-link-status")}>{linkedLabel}</span>
        <button
          className={cm(styles, currentLink === null ? "dark-pipe-link-button" : "dark-pipe-link-button is-danger")}
          data-dark-pipe-link-action={currentLink === null ? "create" : "remove"}
          disabled={currentLink === null && !isSelectingThisEntity && !canCreate}
          onClick={() => {
            if (currentLink !== null) {
              removeLink();
              return;
            }
            if (isSelectingThisEntity) {
              cancelSelection();
              return;
            }
            startSelection();
          }}
          title={buttonLabel}
          type="button"
        >
          {currentLink === null ? <LucideLink2 aria-hidden="true" /> : <LucideUnlink2 aria-hidden="true" />}
          <span>{buttonLabel}</span>
        </button>
      </div>
    </InspectorCollapsiblePanel>
  );
}
