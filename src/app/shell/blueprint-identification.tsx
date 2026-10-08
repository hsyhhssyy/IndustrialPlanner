// AI-REMOVED 2026-10-07:
// Reason: 边界表单改为持久任务状态与预览联动；出口改为自动识别结果。
// Trigger: 用户要求识别任务可恢复、自动识别出口与预览联动。
// Evidence: 原实现只在识别成功后建任务，边界必须全部手动补齐。
// Replacement: src/app/shell/blueprint-identification.tsx BlueprintIdentification
// Risk: 已保存规划任务保留原有格式和验收；Human Review: Required
// Original code:
// import { useEffect, useRef, useState } from "react";
// import { toJS } from "mobx";
// import type { BlueprintDocument } from "@/domain/document/blueprint-document";
// import type { BlueprintPlannerBlueprintBoundary } from "@/domain/blueprint-planner";
// import type { AppHost } from "../host";
// import { ItemDomainFlag } from "@/domain/shared/item-domain-flags";
// import { resolveEffectiveActivityIds, isItemAvailableByActivity } from "@/shared/registry/activity-availability";
// import styles from "./blueprint-planner-dialog.module.scss";
//
// /** 边界配置只属于本次计算；关闭时取消独立识别，不修改编辑中的基地。 */
// export function BlueprintIdentification({ appHost, blueprint, onBusy }: {
//   appHost: AppHost; blueprint: BlueprintDocument; onBusy: (busy: boolean) => void;
// }) {
//   const planner = appHost.workspace.blueprintPlanner!, t = appHost.actions.translate;
//   const [boundaries, setBoundaries] = useState<readonly BlueprintPlannerBlueprintBoundary[] | null>(null);
//   const [error, setError] = useState<string | null>(null);
//   const [running, setRunning] = useState(false);
//   const abort = useRef<AbortController | null>(null);
//   const detected = useRef<readonly BlueprintPlannerBlueprintBoundary[]>([]);
//   const [activeActivityIds] = useState(() => resolveEffectiveActivityIds({ selectedActivityIds: appHost.internalState.settings.selectedActivityIds }));
//   const registry = appHost.workspace.registry;
//   useEffect(() => {
//     const controller = new AbortController();
//     void planner.actions.inspectBlueprint(blueprint, activeActivityIds, controller.signal).then(value => {
//       if (!controller.signal.aborted) { detected.current = value; setBoundaries(value); }
//     }).catch(error => {
//       if (!controller.signal.aborted) setError(String(error instanceof Error ? error.message : error));
//     });
//     return () => { controller.abort(); };
//   }, [planner, blueprint, activeActivityIds]);
//   useEffect(() => () => abort.current?.abort(), []);
//   const identify = async () => {
//     if (!boundaries) return;
//     const controller = new AbortController(); abort.current = controller;
//     setError(null); setRunning(true); onBusy(true);
//     try {
//       const id = await planner.actions.identifyBlueprint({ blueprint, boundaries, activeActivityIds },
//         toJS(appHost.blueprintPlannerDialog.options), controller.signal);
//       appHost.blueprintPlannerDialog.selectTask(id, planner.queries.getLastRequest(id) ?? undefined);
//     } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : String(error)); }
//     finally { setRunning(false); onBusy(false); }
//   };
//   return <section aria-label={t("eda.identifyBlueprint")}>
//     <div className={styles.heading}><p className={styles.target}>{blueprint.name}</p></div>
//     <fieldset className={styles.options} disabled={running}>
//       {boundaries?.map((boundary, index) => {
//         const entity = blueprint.entities[boundary.entityId]!, definition = registry.queries.findEntityDefinition(entity.definitionId)!;
//         const pipe = boundary.kind === "port" ? definition.portGroups.find(group => group.id === boundary.portGroupId)?.isPipe
//           : definition.portGroups.some(group => group.isPipe);
//         return <label key={`${boundary.entityId}/${boundary.portGroupId}/${boundary.portId}/${boundary.direction}`}>
//           <span>{t(boundary.direction === "input" ? "eda.inputBoundary" : "eda.outputBoundary")} · {t(definition.nameKey)} ({entity.position.x}, {entity.position.y})</span>
//           <select aria-label={`${boundary.entityId} ${boundary.direction}`} value={boundary.itemId ?? ""}
//             disabled={detected.current[index]?.itemId != null}
//             onChange={event => setBoundaries(boundaries!.map((entry, at) => at === index ? { ...entry, itemId: event.target.value || null } : entry))}>
//             <option value="">{t("eda.chooseBoundaryItem")}</option>
//             {registry.itemDefinitions.filter(item => isItemAvailableByActivity(item, activeActivityIds) && (pipe
//               ? registry.queries.resolveItemDomain(item.id) !== ItemDomainFlag.Solid
//               : registry.queries.resolveItemDomain(item.id) === ItemDomainFlag.Solid)).map(item => <option key={item.id} value={item.id}>{t(item.nameKey)}</option>)}
//           </select>
//         </label>;
//       })}
//     </fieldset>
//     {running ? <progress aria-label={t("eda.identifyingBlueprint")} /> : null}
//     {error ? <p role="alert" className={styles.error}>{error}</p> : null}
//     <button type="button" disabled={running || boundaries === null || !boundaries.length || boundaries.some(boundary => !boundary.itemId)}
//       onClick={() => void identify()}>{t(running ? "eda.identifyingBlueprint" : "eda.identifyBlueprint")}</button>
//   </section>;
// }
import { useRef, useState } from "react";
import { observer } from "mobx-react-lite";
import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import type { BlueprintPlannerBlueprintBoundary } from "@/domain/blueprint-planner";
import type { AppHost } from "../host";
import { ItemDomainFlag } from "@/domain/shared/item-domain-flags";
import { isItemAvailableByActivity } from "@/shared/registry/activity-availability";
import { blueprintBoundaryKey, isBlueprintRecognitionRequest } from "@/shared/planner-task";
import { BlueprintIdentificationPreview } from "./blueprint-identification-preview";
import styles from "./blueprint-planner-dialog.module.scss";

/** 边界配置只属于本次计算；关闭时取消独立识别，不修改编辑中的基地。 */
// AI-CORRECTION 2026-10-07：配置归属持久任务，关闭面板不取消识别；暂停通过任务操作执行。
export const BlueprintIdentification = observer(function BlueprintIdentification({ appHost, blueprint, taskId }: {
  appHost: AppHost; blueprint: BlueprintDocument; taskId: string | null;
}) {
  const planner = appHost.workspace.blueprintPlanner!, t = appHost.actions.translate;
  void planner.state.revision;
  const current = taskId === null ? null : planner.queries.getLastRequest(taskId);
  const request = current && isBlueprintRecognitionRequest(current) ? current : null;
  const boundaries = request?.input.boundaries ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const [focusVersion, setFocusVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const rows = useRef(new Map<string, HTMLDivElement>());
  const list = useRef<HTMLDivElement>(null);
  const registry = appHost.workspace.registry;
  const running = appHost.blueprintPlannerDialog.taskLocked;
  const choose = (boundary: BlueprintPlannerBlueprintBoundary, focus: boolean) => {
    const key = blueprintBoundaryKey(boundary); setSelected(key);
    if (focus) setFocusVersion(value => value + 1);
    const row = rows.current.get(key), container = list.current;
    if (row && container) {
      const itemRect = row.getBoundingClientRect(), listRect = container.getBoundingClientRect();
      const delta = itemRect.top < listRect.top ? itemRect.top - listRect.top
        : itemRect.bottom > listRect.bottom ? itemRect.bottom - listRect.bottom : 0;
      container.scrollBy({ top: delta });
    }
  };
// AI-REMOVED 2026-10-07:
// Reason: 识别动作归统一底部操作区，低高度屏幕也能直接操作。
// Trigger: 用户要求识别任务可恢复、自动识别出口与预览联动。
// Evidence: 原实现只在识别成功后建任务，边界必须全部手动补齐。
// Replacement: blueprint-planner-dialog.tsx planningActions
// Risk: 已保存规划任务保留原有格式和验收；Human Review: Required
// Original code:
//   const identify = async () => {
//     if (!taskId) return;
//     setError(null);
//     try {
//       await planner.actions.identifyBlueprint(taskId);
//       appHost.blueprintPlannerDialog.selectTask(taskId, planner.queries.getLastRequest(taskId) ?? undefined);
//     } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
//   };
  const update = (boundary: BlueprintPlannerBlueprintBoundary, itemId: string) => {
    if (!taskId) return;
    const fresh = planner.queries.getLastRequest(taskId);
    if (!fresh || !isBlueprintRecognitionRequest(fresh)) return;
    setError(null);
    void planner.actions.updateBlueprintBoundaries(taskId, fresh.input.boundaries.map(entry =>
      blueprintBoundaryKey(entry) === blueprintBoundaryKey(boundary) ? { ...entry, itemId: itemId || null } : entry))
      .catch(failure => setError(failure instanceof Error ? failure.message : String(failure)));
  };
  const inputs = boundaries.filter(boundary => boundary.direction === "input");
  const outputs = boundaries.filter(boundary => boundary.direction === "output");
  return <section aria-label={t("eda.identifyBlueprint")} className={styles.identification}>
    <div className={styles.heading}><p className={styles.target}>{blueprint.name}</p></div>
    <div className={styles.identificationBody}>
      <BlueprintIdentificationPreview appHost={appHost} blueprint={blueprint} boundaries={boundaries}
        selected={selected} focusVersion={focusVersion} onSelect={boundary => choose(boundary, false)} />
      <div ref={list} className={styles.boundaryList}>
        {[{ direction: "input", entries: inputs }, { direction: "output", entries: outputs }].map(group => <fieldset key={group.direction}
          className={styles.boundaryGroup} disabled={running}>
          <legend>{t(group.direction === "input" ? "eda.inputBoundary" : "eda.outputBoundary")}</legend>
          {group.entries.map((boundary, index) => {
            const key = blueprintBoundaryKey(boundary), entity = blueprint.entities[boundary.entityId]!;
            const definition = registry.queries.findEntityDefinition(entity.definitionId)!;
            const pipe = boundary.kind === "port" ? definition.portGroups.find(entry => entry.id === boundary.portGroupId)?.isPipe
              : definition.portGroups.some(entry => entry.isPipe);
            const fixed = request?.detectedBoundaries?.find(entry => blueprintBoundaryKey(entry) === key)?.itemId != null;
            const marker = t(boundary.direction === "input" ? "eda.inputMarker" : "eda.outputMarker").replace("{index}", String(index + 1));
            const item = boundary.itemId ? registry.queries.findItemDefinition(boundary.itemId) : null;
            return <div key={key} ref={element => { if (element) rows.current.set(key, element); else rows.current.delete(key); }}
              className={styles.boundaryRow} data-selected={selected === key}>
              <button type="button" aria-pressed={selected === key} onClick={() => choose(boundary, true)}>
                <strong>{marker}</strong><span>{t(definition.nameKey)} <small>({entity.position.x}, {entity.position.y})</small></span>
              </button>
              {boundary.direction === "output" || fixed ? <output>{item ? t(item.nameKey) : t("eda.detectOutputAutomatically")}</output>
                : <select aria-label={`${marker} · ${t(definition.nameKey)}`} value={boundary.itemId ?? ""}
                  onFocus={() => choose(boundary, true)} onChange={event => update(boundary, event.target.value)}>
                  <option value="">{t("eda.chooseBoundaryItem")}</option>
                  {registry.itemDefinitions.filter(item => isItemAvailableByActivity(item, request?.input.activeActivityIds ?? []) && (pipe
                    ? registry.queries.resolveItemDomain(item.id) !== ItemDomainFlag.Solid
                    : registry.queries.resolveItemDomain(item.id) === ItemDomainFlag.Solid))
                    .map(item => <option key={item.id} value={item.id}>{t(item.nameKey)}</option>)}
                </select>}
            </div>;
          })}
        </fieldset>)}
      </div>
    </div>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {/* AI-REMOVED 2026-10-07: 识别按钮移入统一底部操作区；原代码与审计说明保留在文件末尾。 */}
  </section>;
});

// AI-REMOVED 2026-10-07:
// Reason: 识别按钮固定在底部，避免随蓝图和长边界列表滚出视野。
// Trigger: 用户要求识别任务可恢复、自动识别出口与预览联动。
// Evidence: 原实现只在识别成功后建任务，边界必须全部手动补齐。
// Replacement: blueprint-planner-dialog.tsx planningActions
// Risk: 已保存规划任务保留原有格式和验收；Human Review: Required
// Original code:
//     <button type="button" className={styles.primary} disabled={running || !request?.detectedBoundaries || !boundaries.length || inputs.some(boundary => !boundary.itemId)}
//       onClick={() => void identify()}>{t(running ? "eda.identifyingBlueprint" : "eda.identifyBlueprint")}</button>
