import LucideLink2 from "~icons/lucide/link-2";
import LucideUnlink2 from "~icons/lucide/unlink-2";
import { runInAction } from "mobx";
import { useEffect, useState } from "react";

import type { AppHost } from "@/app/host/app-host";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import {
  DARK_PIPE_LINK_TOOL,
  createRegionalDarkPipeLink,
  findDarkPipeSlotLinkForEntity,
  listDarkPipeLinkCandidateEntityIds,
  resolveDarkPipeLinkedEntityId,
  resolveDarkPipeRole,
  type RegionalDarkPipeEndpoint,
} from "@/shared/dark-pipe-link";
import { InspectorCollapsiblePanel } from "@/app/shell/inspector/inspector-collapsible-panel";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

interface RegionalDarkPipeCandidate {
  readonly key: string;
  readonly endpoint: RegionalDarkPipeEndpoint;
  readonly label: string;
}

export function DarkPipeLinkInspector({
  appHost,
  entity,
  definition,
  translate,
}: {
  appHost: AppHost;
  entity: WorldEntity;
  definition: EntityDefinition;
  translate: (key: string) => string;
}) {
  const editor = appHost.workspace.editor;
  const documentSnapshot = editor?.document?.getSnapshot() ?? null;
  const darkPipeToolState = appHost.internalState.toolInfo;
  const role = resolveDarkPipeRole(definition.id);
  const currentLink = documentSnapshot === null ? null : findDarkPipeSlotLinkForEntity(documentSnapshot, entity.id);
  const currentEndpoint = documentSnapshot === null
    ? null
    : { baseId: documentSnapshot.baseId, entityId: entity.id };
  const currentRegionalLink = currentEndpoint === null
    ? null
    : appHost.regionalSettings.findDarkPipeLink(currentEndpoint);
  const currentRegionalEndpointRole = currentRegionalLink === null || currentEndpoint === null
    ? null
    : currentRegionalLink.inlet.baseId === currentEndpoint.baseId
        && currentRegionalLink.inlet.entityId === currentEndpoint.entityId
      ? "inlet"
      : "outlet";
  const regionalCounterpart = currentRegionalLink === null || currentRegionalEndpointRole === null
    ? null
    : currentRegionalEndpointRole === "inlet"
      ? currentRegionalLink.outlet
      : currentRegionalLink.inlet;
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
  const canCreateRegionalLink = appHost.regionalSettings.multiBaseEnabled
    && appHost.workspace.simulation?.engineKind === "dense-v2";
  const regionalLinksSignature = JSON.stringify(appHost.regionalSettings.darkPipeLinks);
  const currentBase = documentSnapshot === null
    ? undefined
    : appHost.workspace.registry.baseDefinitions.find(
        (base) => base.id === documentSnapshot.baseId,
      );
  const siblingBaseIds = currentBase === undefined
    ? []
    : appHost.workspace.registry.baseDefinitions
        .filter((base) => base.tag === currentBase.tag && base.id !== currentBase.id)
        .map((base) => base.id);
  const regionalCandidateRequestKey = canCreateRegionalLink
    && editor !== null
    && documentSnapshot !== null
    && role !== null
    && currentLink === null
    && currentRegionalLink === null
    && siblingBaseIds.length > 0
    ? JSON.stringify([
        documentSnapshot.documentKey,
        documentSnapshot.baseId,
        entity.id,
        role,
        siblingBaseIds,
        regionalLinksSignature,
      ])
    : null;
  const [regionalCandidateResult, setRegionalCandidateResult] = useState<{
    readonly requestKey: string;
    readonly candidates: readonly RegionalDarkPipeCandidate[];
  } | null>(null);
  const [selectedRegionalCandidateKey, setSelectedRegionalCandidateKey] = useState("");
  const regionalCandidates = regionalCandidateResult?.requestKey === regionalCandidateRequestKey
    ? regionalCandidateResult.candidates
    : [];
  const loadingRegionalCandidates = regionalCandidateRequestKey !== null
    && regionalCandidateResult?.requestKey !== regionalCandidateRequestKey;
  const effectiveSelectedRegionalCandidateKey = regionalCandidates.some(
    (candidate) => candidate.key === selectedRegionalCandidateKey,
  )
    ? selectedRegionalCandidateKey
    : regionalCandidates[0]?.key ?? "";
  const immediateRegionalLinkProblem = currentRegionalLink === null
    ? null
    : role !== currentRegionalEndpointRole
      ? "当前端点角色与已保存关系不一致"
      : regionalCounterpart !== null
          && !appHost.workspace.registry.baseDefinitions.some(
            (base) => base.id === regionalCounterpart.baseId,
          )
        ? "远端基地不存在"
        : null;
  const regionalValidationRequestKey = currentRegionalLink !== null
    && currentRegionalEndpointRole !== null
    && regionalCounterpart !== null
    && editor !== null
    && role !== null
    && immediateRegionalLinkProblem === null
    ? JSON.stringify([
        currentRegionalLink.id,
        currentRegionalEndpointRole,
        regionalCounterpart.baseId,
        regionalCounterpart.entityId,
      ])
    : null;
  const [regionalValidationResult, setRegionalValidationResult] = useState<{
    readonly requestKey: string;
    readonly status: "valid" | "invalid";
    readonly message: string | null;
  } | null>(null);
  const regionalLinkValidation = currentRegionalLink === null
    ? null
    : immediateRegionalLinkProblem !== null
      ? { status: "invalid" as const, message: immediateRegionalLinkProblem }
      : regionalValidationResult?.requestKey === regionalValidationRequestKey
        ? regionalValidationResult
        : { status: "checking" as const, message: null };

  useEffect(() => {
    if (
      regionalValidationRequestKey === null
      || currentRegionalLink === null
      || currentRegionalEndpointRole === null
      || regionalCounterpart === null
      || editor === null
      || role === null
    ) {
      return;
    }

    let cancelled = false;
    void editor.queries.readLatestBaseDocuments([regionalCounterpart.baseId])
      .then(([document]) => {
        if (cancelled) return;
        const counterpartEntity = document?.entities[regionalCounterpart.entityId];
        const expectedRole = currentRegionalEndpointRole === "inlet" ? "outlet" : "inlet";
        if (counterpartEntity === undefined) {
          setRegionalValidationResult({
            requestKey: regionalValidationRequestKey,
            status: "invalid",
            message: "远端暗管已不存在",
          });
          return;
        }
        if (resolveDarkPipeRole(counterpartEntity.definitionId) !== expectedRole) {
          setRegionalValidationResult({
            requestKey: regionalValidationRequestKey,
            status: "invalid",
            message: "远端设备不再是匹配的暗管端点",
          });
          return;
        }
        setRegionalValidationResult({
          requestKey: regionalValidationRequestKey,
          status: "valid",
          message: null,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setRegionalValidationResult({
            requestKey: regionalValidationRequestKey,
            status: "invalid",
            message: "无法读取远端基地",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    currentRegionalEndpointRole,
    currentRegionalLink,
    editor,
    regionalCounterpart,
    regionalValidationRequestKey,
    role,
  ]);

  useEffect(() => {
    if (
      regionalCandidateRequestKey === null
      || editor === null
      || role === null
      || currentBase === undefined
    ) {
      return;
    }

    const siblingBases = appHost.workspace.registry.baseDefinitions.filter((base) =>
      base.tag === currentBase.tag && base.id !== currentBase.id
    );

    let cancelled = false;
    void editor.queries.readLatestBaseDocuments(siblingBases.map((base) => base.id))
      .then((documents) => {
        if (cancelled) return;
        const targetRole = role === "inlet" ? "outlet" : "inlet";
        const candidates = siblingBases.flatMap((base, baseIndex) => {
          const document = documents[baseIndex];
          if (document === undefined) return [];
          return document.entityOrder.flatMap((candidateEntityId) => {
            const candidateEntity = document.entities[candidateEntityId];
            const endpoint = { baseId: base.id, entityId: candidateEntityId };
            if (
              candidateEntity === undefined
              || resolveDarkPipeRole(candidateEntity.definitionId) !== targetRole
              || findDarkPipeSlotLinkForEntity(document, candidateEntityId) !== null
              || appHost.regionalSettings.findDarkPipeLink(endpoint) !== null
            ) {
              return [];
            }
            const candidateDefinition = appHost.workspace.registry.entityDefinitions.find(
              (candidate) => candidate.id === candidateEntity.definitionId,
            );
            const candidateName = candidateDefinition === undefined
              ? candidateEntity.definitionId
              : translate(candidateDefinition.nameKey);
            return [{
              key: createRegionalCandidateKey(endpoint),
              endpoint,
              label: `${base.name} · ${candidateName} · ${candidateEntityId} · (${candidateEntity.position.x}, ${candidateEntity.position.y})`,
            }];
          });
        });
        setRegionalCandidateResult({
          requestKey: regionalCandidateRequestKey,
          candidates,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setRegionalCandidateResult({
          requestKey: regionalCandidateRequestKey,
          candidates: [],
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    appHost,
    currentBase,
    editor,
    regionalCandidateRequestKey,
    role,
    translate,
  ]);

  const canCreate = editor !== null
    && documentSnapshot !== null
    && role !== null
    && currentLink === null
    && currentRegionalLink === null
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

  const createRegionalLink = () => {
    if (currentEndpoint === null || role === null || !canCreateRegionalLink) {
      return;
    }
    const selected = regionalCandidates.find(
      (candidate) => candidate.key === effectiveSelectedRegionalCandidateKey,
    );
    if (selected === undefined) {
      return;
    }
    const inlet = role === "inlet" ? currentEndpoint : selected.endpoint;
    const outlet = role === "outlet" ? currentEndpoint : selected.endpoint;
    appHost.regionalSettings.addDarkPipeLink(createRegionalDarkPipeLink({ inlet, outlet }));
  };

  const removeRegionalLink = () => {
    if (currentRegionalLink !== null) {
      appHost.regionalSettings.removeDarkPipeLink(currentRegionalLink.id);
    }
  };

  const buttonLabel = currentLink !== null
    ? "断开链接"
    : isSelectingThisEntity
      ? "取消选择"
      : "创建链接";
  const linkedLabel = currentRegionalLink !== null
    ? "已使用跨基地链接"
    : linkedEntityId === null
      ? "未链接"
      : `已链接 ${linkedEntityId}`;
  const regionalCounterpartBase = regionalCounterpart === null
    ? null
    : appHost.workspace.registry.baseDefinitions.find(
        (base) => base.id === regionalCounterpart.baseId,
      );

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
      {(canCreateRegionalLink || currentRegionalLink !== null) && (
        <div
          className={cm(styles, "dark-pipe-regional-link")}
          data-dark-pipe-regional-link-state={currentRegionalLink === null
            ? "unlinked"
            : regionalLinkValidation?.status === "invalid"
              ? "invalid"
              : "linked"}
        >
          <span className={cm(styles, "dark-pipe-regional-link-label")}>
            跨基地{currentRegionalLink !== null && !canCreateRegionalLink ? "（当前模式未启用）" : ""}
          </span>
          {currentRegionalLink !== null && regionalCounterpart !== null ? (
            <div className={cm(styles, "dark-pipe-link-row")}>
              <span className={cm(styles, "dark-pipe-link-status")}>
                {regionalLinkValidation?.status === "invalid"
                  ? `端点失效：${regionalLinkValidation.message ?? "未知原因"}`
                  : regionalLinkValidation?.status === "checking"
                    ? "正在校验远端端点…"
                    : `${regionalCounterpartBase?.name ?? regionalCounterpart.baseId} · ${regionalCounterpart.entityId}`}
              </span>
              <button
                className={cm(styles, "dark-pipe-link-button is-danger")}
                data-dark-pipe-regional-link-action="remove"
                onClick={removeRegionalLink}
                title="断开跨基地链接"
                type="button"
              >
                <LucideUnlink2 aria-hidden="true" />
                <span>断开链接</span>
              </button>
            </div>
          ) : (
            <div className={cm(styles, "dark-pipe-regional-link-controls")}>
              <select
                aria-label="跨基地暗管目标"
                className={cm(styles, "dark-pipe-regional-link-select")}
                disabled={currentLink !== null || loadingRegionalCandidates || regionalCandidates.length === 0}
                onChange={(event) => setSelectedRegionalCandidateKey(event.target.value)}
                value={effectiveSelectedRegionalCandidateKey}
              >
                {regionalCandidates.length === 0 ? (
                  <option value="">
                    {loadingRegionalCandidates ? "正在读取其他基地…" : "没有可链接的暗管"}
                  </option>
                ) : regionalCandidates.map((candidate) => (
                  <option key={candidate.key} value={candidate.key}>{candidate.label}</option>
                ))}
              </select>
              <button
                className={cm(styles, "dark-pipe-link-button")}
                data-dark-pipe-regional-link-action="create"
                disabled={currentLink !== null || effectiveSelectedRegionalCandidateKey === ""}
                onClick={createRegionalLink}
                title="创建跨基地链接"
                type="button"
              >
                <LucideLink2 aria-hidden="true" />
                <span>创建链接</span>
              </button>
            </div>
          )}
        </div>
      )}
    </InspectorCollapsiblePanel>
  );
}

function createRegionalCandidateKey(endpoint: RegionalDarkPipeEndpoint): string {
  return `${endpoint.baseId}\u0000${endpoint.entityId}`;
}
