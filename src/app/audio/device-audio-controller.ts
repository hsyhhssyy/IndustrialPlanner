// AI-REMOVED 2026-09-26:
// Reason: 音效运行时提取为独立 Audio 模块，App 仅保留 UI 与真实手势入口。
// Trigger: 用户授权模块重构并逐项确认 AudioAction、AudioContract 和 WorkspaceContract.audio。
// Evidence: 原 AppHost 持有控制器，WorkbenchApp effect 管理播放订阅生命周期。
// Replacement: src/audio/device-audio-controller.ts；旧文件仅作审计归档，不再导出活动实现。
// Risk: 需验证手势解锁、单实例生命周期及销毁后的迟到任务。
// Human Review: Required
// Original code:
// import { reaction } from "mobx";
// import type { WorkspaceContract } from "@/domain/document/workspace-contract";
// import type { WorldEntity } from "@/domain/document/world-document";
// import type { EditorHistoryRecord } from "@/domain/editor/editor-history";
// import type { GridRect } from "@/domain/shared/grid";
// import { createPublicAssetUrl } from "@/shared/browser/public-asset-url";
// // AI-REMOVED 2026-09-26:
// // Reason: 矩形相交索引无法选取屏幕外的最近设备。
// // Trigger: 用户要求屏内最近 10 台原音量，余下最近 10 台降至 20%。
// // Evidence: GridRectIndex 只有 at/intersecting 查询；音效需统一筛选屏内外设备。
// // Replacement: audio-spatial-mix.ts 的固定大小距离候选列表。
// // Risk: Low；缓存设备几何，候选集合大小固定。
// // Human Review: Required
// // Original code:
// // import { GridRectIndex } from "@/shared/geometry/grid-rect-index";
// import { resolveEntityGridRect } from "@/shared/geometry/power-range";
// import { resolveWorldPointFromViewportPoint } from "@/shared/geometry/viewport-transform";
// import { parseDeviceAudioManifest, type DeviceAudioBinding, type DeviceAudioManifest, type DeviceAudioState } from "./audio-manifest";
// import { DeviceAudioPlayer } from "./audio-player";
// import { selectDeviceAudioGains } from "./audio-spatial-mix";
//
// interface AudibleEntity { entity: WorldEntity; rect: GridRect }
//
// export function resolveCommittedAudio(record: EditorHistoryRecord): { state: "build" | "remove"; entities: WorldEntity[] } | null {
//   if (["entity.place", "blueprint.place", "logistics.place"].includes(record.action.type)) {
//     return { state: "build", entities: Object.values(record.delta.entities.added) };
//   }
//   if (record.action.type === "entity.delete") {
//     return { state: "remove", entities: Object.values(record.delta.entities.removed) };
//   }
//   return null;
// }
//
// export class DeviceAudioController {
//   private readonly player = new DeviceAudioPlayer();
//   private manifest: DeviceAudioManifest | null = null;
//   private manifestRequest: AbortController | null = null;
//   private retryAfter = 0;
//   private disposeMount: (() => void) | null = null;
//   private documentKey: string | null = null;
//   private indexedEntities: unknown = null;
//   private index: AudibleEntity[] = [];
//   private readonly removedEntities = new Map<string, WorldEntity>();
//   private previousStates = new Map<string, DeviceAudioState | null>();
//   private restoring = true;
//   private starting = false;
//   private serial = 0;
//
//   public constructor(private readonly workspace: WorkspaceContract, private readonly readEnabled: () => boolean) {}
//
//   public mount(): () => void {
//     this.disposeMount?.();
//     const editor = this.workspace.editor;
//     if (!editor) return () => undefined;
//     const unlock = (event: Event) => {
//       if (event.isTrusted && this.readEnabled() && !document.hidden) {
//         this.player.setEnabled(true);
//         this.player.unlock();
//         this.refresh();
//       }
//     };
//     const visibility = () => {
//       this.reset();
//       if (document.hidden) this.player.pauseWork(true);
//       else {
//         const state = this.workspace.simulation?.state;
//         this.player.pauseWork(state?.runningState !== "start" || state.timeline.isSeeking);
//       }
//       this.refresh();
//     };
//     window.addEventListener("pointerdown", unlock);
//     window.addEventListener("keydown", unlock);
//     window.addEventListener("click", unlock);
//     document.addEventListener("visibilitychange", visibility);
//     const unsubscribe = editor.queries.subscribeCommittedEdits((record) => {
//       this.refreshIndex();
//       if (record.documentKey !== editor.document.getSnapshot().documentKey) return;
//       const event = resolveCommittedAudio(record);
//       if (event) this.playBatch(event.entities, event.state);
//     });
//     const unsubscribeDocument = editor.document.subscribe(() => {
//       if (this.readEnabled()) {
//         this.refreshIndex();
//         this.player.discardInvalidVoices();
//         this.refresh();
//       }
//     });
//     const stopSettings = reaction(this.readEnabled, (enabled) => {
//       this.player.setEnabled(enabled);
//       this.reset();
//       if (!enabled) {
//         this.manifestRequest?.abort();
//         this.manifestRequest = null;
//       }
//       this.refresh();
//     }, { fireImmediately: true });
//     const stopSimulation = reaction(() => {
//       const state = this.workspace.simulation?.state;
//       return [state?.runningState, state?.timeline.isSeeking] as const;
//     }, ([running, seeking], previous) => {
//       if (seeking || running === "stop" || running === "starting") this.reset();
//       this.starting = running === "start" && (previous?.[0] === "stop" || previous?.[0] === "starting");
//       this.player.pauseWork(running !== "start" || seeking === true);
//       this.refresh();
//     });
//     const interval = window.setInterval(() => this.refresh(), 200);
//     const cleanup = () => {
//       window.clearInterval(interval);
//       unsubscribe();
//       unsubscribeDocument();
//       stopSettings();
//       stopSimulation();
//       window.removeEventListener("pointerdown", unlock);
//       window.removeEventListener("keydown", unlock);
//       window.removeEventListener("click", unlock);
//       document.removeEventListener("visibilitychange", visibility);
//       this.manifestRequest?.abort();
//       this.manifestRequest = null;
//       this.player.setEnabled(false);
//       this.reset();
//       this.disposeMount = null;
//     };
//     this.disposeMount = cleanup;
//     return cleanup;
//   }
//
//   public dispose(): void { this.disposeMount?.(); }
//
//   public playInspector(): void {
//     const editor = this.workspace.editor;
//     if (!editor || editor.state.collections.selection.length !== 1) return;
//     const id = editor.state.collections.selection[0];
//     const entity = id ? editor.queries.getEntityById(id) : null;
//     if (entity) this.playBatch([entity], "uiOpen");
//   }
//
//   private playBatch(entities: readonly WorldEntity[], state: "build" | "remove" | "uiOpen"): void {
//     if (!this.readEnabled() || document.hidden || !this.player.ready || !this.manifest) return;
//     const visible = this.visibleRect();
//     if (!visible) return;
//     this.refreshIndex();
//     const gains = this.updateMix(visible, state === "remove" ? entities : []);
//     const candidates = new Map(entities.map((entity) => [entity.id, entity]));
//     const clips = new Set<string>();
//     for (const id of gains.keys()) {
//       const entity = candidates.get(id);
//       if (!entity) continue;
//       const binding = this.manifest.definitions[entity.definitionId]?.[state];
//       if (!binding || clips.has(binding.clip)) continue;
//       clips.add(binding.clip);
//       const documentKey = this.workspace.editor?.document.getSnapshot().documentKey;
//       this.player.play(`action:${++this.serial}`, entity.id, binding, this.manifest, false, 1, () => {
//         const snapshot = this.workspace.editor?.document.getSnapshot();
//         return snapshot?.documentKey === documentKey
//           && (state === "remove" || snapshot?.entities[entity.id]?.definitionId === entity.definitionId);
//       });
//       if (clips.size >= 4) break;
//     }
//   }
//
//   private reset(): void {
//     this.player.stopAll();
//     this.removedEntities.clear();
//     this.previousStates.clear();
//     this.restoring = true;
//   }
//
//   private refreshIndex(): void {
//     const snapshot = this.workspace.editor?.document.getSnapshot();
//     if (!snapshot) return;
//     if (this.documentKey !== snapshot.documentKey) {
//       this.documentKey = snapshot.documentKey;
//       this.reset();
//     }
//     if (snapshot.entities === this.indexedEntities) return;
//     this.indexedEntities = snapshot.entities;
//     const entries: AudibleEntity[] = [];
//     for (const entity of Object.values(snapshot.entities)) {
//       const states = this.manifest?.definitions[entity.definitionId];
//       if (!states || Object.keys(states).length === 0) continue;
//       const definition = this.workspace.registry.queries.findEntityDefinition(entity.definitionId);
//       if (definition) entries.push({ entity, rect: resolveEntityGridRect({ entity, definition }) });
//     }
//     this.index = entries;
//   }
//
//   private updateMix(visible: GridRect, removed: readonly WorldEntity[] = []): Map<string, number> {
//     const active = this.player.activeDeviceIds;
//     for (const id of this.removedEntities.keys()) if (!active.has(id)) this.removedEntities.delete(id);
//     for (const entity of removed) this.removedEntities.set(entity.id, entity);
//     const snapshot = this.workspace.editor?.document.getSnapshot();
//     const entries = [...this.index];
//     // 删除声沿用删除前的位置，播放期间仍参与同一份 10 + 10 设备名单。
//     for (const entity of this.removedEntities.values()) {
//       if (snapshot?.entities[entity.id] || !this.manifest?.definitions[entity.definitionId]?.remove) continue;
//       const definition = this.workspace.registry.queries.findEntityDefinition(entity.definitionId);
//       if (definition) entries.push({ entity, rect: resolveEntityGridRect({ entity, definition }) });
//     }
//     const gains = selectDeviceAudioGains(entries, visible);
//     this.player.setDeviceGains(gains);
//     return gains;
//   }
//
//   private refresh(): void {
//     if (!this.readEnabled() || document.hidden) return;
//     if (!this.manifest) { this.loadManifest(); return; }
//     this.refreshIndex();
//     this.player.discardInvalidVoices();
//     const visible = this.visibleRect();
//     if (!visible) { this.reset(); return; }
//     const gains = this.updateMix(visible);
//     const simulation = this.workspace.simulation;
//     if (!this.player.ready || !simulation || simulation.state.timeline.isSeeking) return;
//     const running = simulation.state.runningState;
//     if (running === "stop" || running === "starting") return;
//     // AI-REMOVED 2026-09-26:
//     // Reason: 旧筛选只覆盖屏内，距离使用左上角，不能支持用户要求的两档设备混音。
//     // Trigger: 屏内最近 10 台原音量，余下最近 10 台为 20%，其余停止。
//     // Evidence: 原查询 intersecting 排除了所有屏外设备，且运行声额外限制为 12 台。
//     // Replacement: updateMix/selectDeviceAudioGains，使用设备中心并统一约束全部音效。
//     // Risk: Low；同距按 ID 排序，运行声换档不会重新播放。
//     // Human Review: Required
//     // Original code:
//     // const center = { x: visible.x + visible.width / 2, y: visible.y + visible.height / 2 };
//     // const candidates = this.index.intersecting(visible).sort((a, b) =>
//     //   Math.hypot(a.rect.x - center.x, a.rect.y - center.y) - Math.hypot(b.rect.x - center.x, b.rect.y - center.y));
//     const nextStates = new Map<string, DeviceAudioState | null>();
//     const retained = new Set<string>();
//     const pending: { key: string; entityId: string; binding: DeviceAudioBinding }[] = [];
//     const snapshot = this.workspace.editor?.document.getSnapshot();
//     for (const id of gains.keys()) {
//       const entity = snapshot?.entities[id];
//       if (!entity) continue;
//       const status = simulation.queries.getDeviceOperatingStatus(entity.id);
//       const state = status === "normal" ? "working" : status === "idle" ? "idle" : null;
//       nextStates.set(entity.id, state);
//       if (!state) continue;
//       const binding = this.manifest.definitions[entity.definitionId]?.[state];
//       if (!binding) continue;
//       const key = `work:${entity.id}:${state}:${binding.clip}`;
//       retained.add(key);
//       const entered = this.previousStates.has(entity.id) && this.previousStates.get(entity.id) !== state;
//       if (running === "start" && (binding.loop || this.starting || (!this.restoring && entered))) {
//         pending.push({ key, entityId: entity.id, binding });
//       }
//     }
//     this.player.retainWork(retained);
//     for (const { key, entityId, binding } of pending) this.player.play(key, entityId, binding, this.manifest, true, 0.35);
//     this.previousStates = nextStates;
//     this.restoring = false;
//     this.starting = false;
//   }
//
//   private visibleRect(): GridRect | null {
//     const viewport = this.workspace.editor?.state.viewport;
//     if (!viewport || viewport.clientRect.width <= 0 || viewport.clientRect.height <= 0) return null;
//     const { left, top, width, height } = viewport.clientRect;
//     const points = [[left, top], [left + width, top], [left, top + height], [left + width, top + height]]
//       .map(([x, y]) => resolveWorldPointFromViewportPoint({
//         viewportBounds: viewport.clientRect, viewportCenter: viewport.center,
//         gridCellPixelSize: viewport.gridCellPixelSize, displayRotation: viewport.displayRotation,
//         viewportPoint: { x: x!, y: y! },
//       }));
//     if (points.some((point) => point === null)) return null;
//     const xs = points.map((point) => point!.x), ys = points.map((point) => point!.y);
//     return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
//   }
//
//   private loadManifest(): void {
//     if (this.manifestRequest || performance.now() < this.retryAfter) return;
//     const request = new AbortController();
//     this.manifestRequest = request;
//     void (async () => {
//       try {
//         const response = await fetch(createPublicAssetUrl("device-audio/manifest.json"), { signal: request.signal });
//         if (!response.ok) throw new Error(`Audio manifest HTTP ${response.status}`);
//         const manifest = parseDeviceAudioManifest(await response.json());
//         if (request.signal.aborted) return;
//         this.manifest = manifest;
//         this.indexedEntities = null;
//         this.refresh();
//       } catch (error) {
//         if (!request.signal.aborted) {
//           this.retryAfter = performance.now() + 30_000;
//           console.warn("Device audio manifest is unavailable", error);
//         }
//       } finally {
//         if (this.manifestRequest === request) this.manifestRequest = null;
//       }
//     })();
//   }
// }
