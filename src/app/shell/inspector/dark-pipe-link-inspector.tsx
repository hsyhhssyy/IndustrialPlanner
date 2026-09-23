import LucideLink2 from "~icons/lucide/link-2";
import LucideUnlink2 from "~icons/lucide/unlink-2";
import { runInAction } from "mobx";
import { useEffect, useState } from "react";

import type { AppHost } from "@/app/host/app-host";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import {
  DARK_PIPE_LINK_TOOL,
  // AI-REMOVED 2026-09-23:
  // Reason: 跨基地建链由暗管链接手势完成，不再由下拉框按钮完成。
  // Trigger: 用户要求两种链接复用同一按钮。
  // Evidence: createRegionalLink 已归档。
  // Replacement: hypergryph-dark-pipe-link-gesture-module.ts。
  // Risk: Low
  // Human Review: Required
  // Original code:
  // createRegionalDarkPipeLink,
  findDarkPipeSlotLinkForEntity,
  listDarkPipeLinkCandidateEntityIds,
  resolveDarkPipeLinkedEntityId,
  resolveDarkPipeRole,
  // AI-REMOVED 2026-09-23:
  // Reason: 候选下拉框数据模型已退出。
  // Trigger: 用户要求通过基地切换与画布点击建链。
  // Evidence: RegionalDarkPipeCandidate 已归档。
  // Replacement: hypergryph-dark-pipe-link-gesture-module.ts。
  // Risk: Low
  // Human Review: Required
  // Original code:
  // type RegionalDarkPipeEndpoint,
} from "@/shared/dark-pipe-link";
import { InspectorCollapsiblePanel } from "@/app/shell/inspector/inspector-collapsible-panel";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";


export function DarkPipeLinkInspector({
  appHost,
  entity,
  definition,
  // AI-REMOVED 2026-09-23:
  // Reason: 下拉框不再需要翻译候选设备名。
  // Trigger: 用户要求移除跨基地候选下拉框。
  // Evidence: 候选加载 effect 已归档。
  // Replacement: None。
  // Risk: Low
  // Human Review: Required
  // Original code:
  // translate,
}: {
  appHost: AppHost;
  entity: WorldEntity;
  definition: EntityDefinition;
  translate: (key: string) => string;
  // AI-CORRECTION 2026-09-23: translate 参数类型暂留以维持 Inspector 调用契约；组件已不读取其值。
  // AI-REMOVED 2026-09-23:
  // Reason: 下拉框候选设备名已退出。
  // Trigger: 用户要求移除跨基地候选下拉框。
  // Evidence: 组件内不再使用 translate。
  // Replacement: None。
  // Risk: Low
  // Human Review: Required
  // Original code:
  // translate: (key: string) => string;
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
  const selectingState = appHost.internalState.toolInfo.darkPipeLink;
  const isSelectingThisEntity = appHost.state.activeTool === DARK_PIPE_LINK_TOOL
    && selectingState?.sourceBaseId === documentSnapshot?.baseId
    && selectingState?.sourceEntityId === entity.id;
  const canCreateRegionalLink = appHost.state.settings.regionalMultiBaseEnabled
    && appHost.workspace.simulation?.engineKind === "dense-v2";
  const activeRegionalLink = canCreateRegionalLink ? currentRegionalLink : null;

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
  const regionalValidationRequestKey = activeRegionalLink !== null
    && currentRegionalEndpointRole !== null
    && regionalCounterpart !== null
    && editor !== null
    && role !== null
    && immediateRegionalLinkProblem === null
    ? JSON.stringify([
        activeRegionalLink.id,
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
  const regionalLinkValidation = activeRegionalLink === null
    ? null
    : immediateRegionalLinkProblem !== null
      ? { status: "invalid" as const, message: immediateRegionalLinkProblem }
      : regionalValidationResult?.requestKey === regionalValidationRequestKey
        ? regionalValidationResult
        : { status: "checking" as const, message: null };

  useEffect(() => {
    if (
      regionalValidationRequestKey === null
      || activeRegionalLink === null
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
    activeRegionalLink,
    editor,
    regionalCounterpart,
    regionalValidationRequestKey,
    role,
  ]);

  const canCreate = editor !== null
    && documentSnapshot !== null
    && role !== null
    && currentLink === null
    && activeRegionalLink === null
    && (candidates.length > 0 || (canCreateRegionalLink && siblingBaseIds.length > 0));

  const startSelection = () => {
    if (!canCreate || role === null || documentSnapshot === null) {
      return;
    }

    const returnTool = appHost.state.activeTool === DARK_PIPE_LINK_TOOL
      ? "select"
      : appHost.state.activeTool;
    runInAction(() => {
      darkPipeToolState.darkPipeLink = {
        sourceBaseId: documentSnapshot.baseId,
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
  const removeRegionalLink = () => {
    if (activeRegionalLink !== null) {
      appHost.regionalSettings.removeDarkPipeLink(activeRegionalLink.id);
    }
  };

  const regionalCounterpartBase = regionalCounterpart === null
    ? null
    : appHost.workspace.registry.baseDefinitions.find(
        (base) => base.id === regionalCounterpart.baseId,
      );
  const hasActiveLink = currentLink !== null || activeRegionalLink !== null;
  const buttonLabel = hasActiveLink
    ? "断开链接"
    : isSelectingThisEntity
      ? "取消选择"
      : "创建链接";
  const linkedLabel = currentLink !== null
    ? `已连接 ${linkedEntityId ?? ""}`
    : activeRegionalLink === null
      ? "未连接"
      : regionalLinkValidation?.status === "invalid"
        ? `端点失效：${regionalLinkValidation.message ?? "未知原因"}`
        : regionalLinkValidation?.status === "checking"
          ? "正在校验远端端点…"
          : `${regionalCounterpartBase?.name ?? regionalCounterpart?.baseId} · ${regionalCounterpart?.entityId}`;
  return (
    <InspectorCollapsiblePanel
      className="dark-pipe-link-inspector"
      dataInspectorKey="dark-pipe-link"
      title="暗管链接"
    >
      <div
        className={cm(styles, "dark-pipe-link-row")}
        data-dark-pipe-link-state={hasActiveLink ? "linked" : "unlinked"}
      >
        <span className={cm(styles, "dark-pipe-link-status")}>{linkedLabel}</span>
        <button
          className={cm(styles, hasActiveLink ? "dark-pipe-link-button is-danger" : "dark-pipe-link-button")}
          data-dark-pipe-link-action={hasActiveLink ? "remove" : "create"}
          disabled={!hasActiveLink && !isSelectingThisEntity && !canCreate}
          onClick={() => {
            if (currentLink !== null) {
              removeLink();
              return;
            }
            if (activeRegionalLink !== null) {
              removeRegionalLink();
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
          {hasActiveLink ? <LucideUnlink2 aria-hidden="true" /> : <LucideLink2 aria-hidden="true" />}
          <span>{buttonLabel}</span>
        </button>
      </div>
    </InspectorCollapsiblePanel>
  );
}


// AI-REMOVED 2026-09-23:
// Reason: 远端候选不再作为下拉框数据模型。
// Trigger: 用户要求同基地与跨基地使用同一按钮，并通过基地切换后点击暗管选点。
// Evidence: 旧候选下拉框与当前暗管链接手势是两套独立入口。
// Replacement: 跨基地点击直接读取目标画布实体。
// Risk: Low
// Human Review: Required
//
// Original code:
// interface RegionalDarkPipeCandidate {
//   readonly key: string;
//   readonly endpoint: RegionalDarkPipeEndpoint;
//   readonly label: string;
// }

// AI-REMOVED 2026-09-23:
// Reason: 下拉候选请求的签名不再使用。
// Trigger: 用户要求同基地与跨基地使用同一按钮，并通过基地切换后点击暗管选点。
// Evidence: 旧候选下拉框与当前暗管链接手势是两套独立入口。
// Replacement: 暗管链接手势实时校验点击目标。
// Risk: Low
// Human Review: Required
//
// Original code:
//   const regionalLinksSignature = JSON.stringify(appHost.regionalSettings.darkPipeLinks);
//   const currentBase = documentSnapshot === null

// AI-REMOVED 2026-09-23:
// Reason: 下拉候选请求、加载和选择状态不再使用。
// Trigger: 用户要求同基地与跨基地使用同一按钮，并通过基地切换后点击暗管选点。
// Evidence: 旧候选下拉框与当前暗管链接手势是两套独立入口。
// Replacement: 暗管链接手势实时校验点击目标。
// Risk: Low
// Human Review: Required
//
// Original code:
//   const regionalCandidateRequestKey = canCreateRegionalLink
//     && editor !== null
//     && documentSnapshot !== null
//     && role !== null
//     && currentLink === null
//     && currentRegionalLink === null
//     && siblingBaseIds.length > 0
//     ? JSON.stringify([
//         documentSnapshot.documentKey,
//         documentSnapshot.baseId,
//         entity.id,
//         role,
//         siblingBaseIds,
//         regionalLinksSignature,
//       ])
//     : null;
//   const [regionalCandidateResult, setRegionalCandidateResult] = useState<{
//     readonly requestKey: string;
//     readonly candidates: readonly RegionalDarkPipeCandidate[];
//   } | null>(null);
//   const [selectedRegionalCandidateKey, setSelectedRegionalCandidateKey] = useState("");
//   const regionalCandidates = regionalCandidateResult?.requestKey === regionalCandidateRequestKey
//     ? regionalCandidateResult.candidates
//     : [];
//   const loadingRegionalCandidates = regionalCandidateRequestKey !== null
//     && regionalCandidateResult?.requestKey !== regionalCandidateRequestKey;
//   const effectiveSelectedRegionalCandidateKey = regionalCandidates.some(
//     (candidate) => candidate.key === selectedRegionalCandidateKey,
//   )
//     ? selectedRegionalCandidateKey
//     : regionalCandidates[0]?.key ?? "";
//   const immediateRegionalLinkProblem

// AI-REMOVED 2026-09-23:
// Reason: 不再预读其他基地的全部暗管作为下拉选项。
// Trigger: 用户要求同基地与跨基地使用同一按钮，并通过基地切换后点击暗管选点。
// Evidence: 旧候选下拉框与当前暗管链接手势是两套独立入口。
// Replacement: 切换基地后直接在画布选点。
// Risk: Low
// Human Review: Required
//
// Original code:
//   useEffect(() => {
//     if (
//       regionalCandidateRequestKey === null
//       || editor === null
//       || role === null
//       || currentBase === undefined
//     ) {
//       return;
//     }
//
//     const siblingBases = appHost.workspace.registry.baseDefinitions.filter((base) =>
//       base.tag === currentBase.tag && base.id !== currentBase.id
//     );
//
//     let cancelled = false;
//     void editor.queries.readLatestBaseDocuments(siblingBases.map((base) => base.id))
//       .then((documents) => {
//         if (cancelled) return;
//         const targetRole = role === "inlet" ? "outlet" : "inlet";
//         const candidates = siblingBases.flatMap((base, baseIndex) => {
//           const document = documents[baseIndex];
//           if (document === undefined) return [];
//           return document.entityOrder.flatMap((candidateEntityId) => {
//             const candidateEntity = document.entities[candidateEntityId];
//             const endpoint = { baseId: base.id, entityId: candidateEntityId };
//             if (
//               candidateEntity === undefined
//               || resolveDarkPipeRole(candidateEntity.definitionId) !== targetRole
//               || findDarkPipeSlotLinkForEntity(document, candidateEntityId) !== null
//               || appHost.regionalSettings.findDarkPipeLink(endpoint) !== null
//             ) {
//               return [];
//             }
//             const candidateDefinition = appHost.workspace.registry.entityDefinitions.find(
//               (candidate) => candidate.id === candidateEntity.definitionId,
//             );
//             const candidateName = candidateDefinition === undefined
//               ? candidateEntity.definitionId
//               : translate(candidateDefinition.nameKey);
//             return [{
//               key: createRegionalCandidateKey(endpoint),
//               endpoint,
//               label: `${base.name} · ${candidateName} · ${candidateEntityId} · (${candidateEntity.position.x}, ${candidateEntity.position.y})`,
//             }];
//           });
//         });
//         setRegionalCandidateResult({
//           requestKey: regionalCandidateRequestKey,
//           candidates,
//         });
//       })
//       .catch(() => {
//         if (cancelled) return;
//         setRegionalCandidateResult({
//           requestKey: regionalCandidateRequestKey,
//           candidates: [],
//         });
//       });
//
//     return () => {
//       cancelled = true;
//     };
//   }, [
//     appHost,
//     currentBase,
//     editor,
//     regionalCandidateRequestKey,
//     role,
//     translate,
//   ]);
//
//   const canCreate = editor !== null

// AI-REMOVED 2026-09-23:
// Reason: 删除独立的跨基地建链按钮。
// Trigger: 用户要求同基地与跨基地使用同一按钮，并通过基地切换后点击暗管选点。
// Evidence: 旧候选下拉框与当前暗管链接手势是两套独立入口。
// Replacement: 同一创建链接按钮启动暗管链接手势。
// Risk: Low
// Human Review: Required
//
// Original code:
//   const createRegionalLink = () => {
//     if (currentEndpoint === null || role === null || !canCreateRegionalLink) {
//       return;
//     }
//     const selected = regionalCandidates.find(
//       (candidate) => candidate.key === effectiveSelectedRegionalCandidateKey,
//     );
//     if (selected === undefined) {
//       return;
//     }
//     const inlet = role === "inlet" ? currentEndpoint : selected.endpoint;
//     const outlet = role === "outlet" ? currentEndpoint : selected.endpoint;
//     appHost.regionalSettings.addDarkPipeLink(createRegionalDarkPipeLink({ inlet, outlet }));
//   };
//
//   const removeRegionalLink = () => {

// AI-REMOVED 2026-09-23:
// Reason: 删除跨基地下拉框和第二套按钮。
// Trigger: 用户要求同基地与跨基地使用同一按钮，并通过基地切换后点击暗管选点。
// Evidence: 旧候选下拉框与当前暗管链接手势是两套独立入口。
// Replacement: 暗管链接面板单按钮与状态行。
// Risk: Low
// Human Review: Required
//
// Original code:
//       {(canCreateRegionalLink || currentRegionalLink !== null) && (
//         <div
//           className={cm(styles, "dark-pipe-regional-link")}
//           data-dark-pipe-regional-link-state={currentRegionalLink === null
//             ? "unlinked"
//             : regionalLinkValidation?.status === "invalid"
//               ? "invalid"
//               : "linked"}
//         >
//           <span className={cm(styles, "dark-pipe-regional-link-label")}>
//             跨基地{currentRegionalLink !== null && !canCreateRegionalLink ? "（当前模式未启用）" : ""}
//           </span>
//           {currentRegionalLink !== null && regionalCounterpart !== null ? (
//             <div className={cm(styles, "dark-pipe-link-row")}>
//               <span className={cm(styles, "dark-pipe-link-status")}>
//                 {regionalLinkValidation?.status === "invalid"
//                   ? `端点失效：${regionalLinkValidation.message ?? "未知原因"}`
//                   : regionalLinkValidation?.status === "checking"
//                     ? "正在校验远端端点…"
//                     : `${regionalCounterpartBase?.name ?? regionalCounterpart.baseId} · ${regionalCounterpart.entityId}`}
//               </span>
//               <button
//                 className={cm(styles, "dark-pipe-link-button is-danger")}
//                 data-dark-pipe-regional-link-action="remove"
//                 onClick={removeRegionalLink}
//                 title="断开跨基地链接"
//                 type="button"
//               >
//                 <LucideUnlink2 aria-hidden="true" />
//                 <span>断开链接</span>
//               </button>
//             </div>
//           ) : (
//             <div className={cm(styles, "dark-pipe-regional-link-controls")}>
//               <select
//                 aria-label="跨基地暗管目标"
//                 className={cm(styles, "dark-pipe-regional-link-select")}
//                 disabled={currentLink !== null || loadingRegionalCandidates || regionalCandidates.length === 0}
//                 onChange={(event) => setSelectedRegionalCandidateKey(event.target.value)}
//                 value={effectiveSelectedRegionalCandidateKey}
//               >
//                 {regionalCandidates.length === 0 ? (
//                   <option value="">
//                     {loadingRegionalCandidates ? "正在读取其他基地…" : "没有可链接的暗管"}
//                   </option>
//                 ) : regionalCandidates.map((candidate) => (
//                   <option key={candidate.key} value={candidate.key}>{candidate.label}</option>
//                 ))}
//               </select>
//               <button
//                 className={cm(styles, "dark-pipe-link-button")}
//                 data-dark-pipe-regional-link-action="create"
//                 disabled={currentLink !== null || effectiveSelectedRegionalCandidateKey === ""}
//                 onClick={createRegionalLink}
//                 title="创建跨基地链接"
//                 type="button"
//               >
//                 <LucideLink2 aria-hidden="true" />
//                 <span>创建链接</span>
//               </button>
//             </div>
//           )}
//         </div>
//       )}
//     </InspectorCollapsiblePanel>

// AI-REMOVED 2026-09-23:
// Reason: 下拉候选键不再使用。
// Trigger: 用户要求同基地与跨基地使用同一按钮，并通过基地切换后点击暗管选点。
// Evidence: 旧候选下拉框与当前暗管链接手势是两套独立入口。
// Replacement: 暗管链接手势使用端点对象。
// Risk: Low
// Human Review: Required
//
// Original code:
// function createRegionalCandidateKey(endpoint: RegionalDarkPipeEndpoint): string {
//   return `${endpoint.baseId}\u0000${endpoint.entityId}`;
// }
