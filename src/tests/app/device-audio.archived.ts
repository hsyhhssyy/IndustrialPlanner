// AI-REMOVED 2026-09-26:
// Reason: 音效运行时提取为独立 Audio 模块，App 仅保留 UI 与真实手势入口。
// Trigger: 用户授权模块重构并逐项确认 AudioAction、AudioContract 和 WorkspaceContract.audio。
// Evidence: 原 AppHost 持有控制器，WorkbenchApp effect 管理播放订阅生命周期。
// Replacement: src/tests/audio/device-audio.test.ts；测试断言原样迁移，归档文件退出测试发现。
// Risk: 需验证手势解锁、单实例生命周期及销毁后的迟到任务。
// Human Review: Required
// Original code:
// import { createHash } from "node:crypto";
// import { readFileSync } from "node:fs";
// import { describe, expect, it } from "vitest";
// import { parseDeviceAudioManifest } from "@/app/audio/audio-manifest";
// import { resolveCommittedAudio } from "@/app/audio/device-audio-controller";
// import { selectDeviceAudioGains } from "@/app/audio/audio-spatial-mix";
// import { createWorldDocument, type WorldEntity } from "@/domain/document/world-document";
// import type { EditorHistoryRecord } from "@/domain/editor/editor-history";
// import { createWorldDocumentDelta } from "@/editor/history";
//
// const raw: unknown = JSON.parse(readFileSync("public/device-audio/manifest.json", "utf8"));
//
// const deviceAt = (id: string, x: number, y = 0, width = 1, height = 1) => ({
//   entity: { id }, rect: { x, y, width, height },
// });
//
// describe("设备音效距离分档", () => {
//   it("keeps only the nearest ten visible devices full and the next ten at twenty percent", () => {
//     const devices = Array.from({ length: 35 }, (_, index) => deviceAt(`device-${index}`, index + 1));
//     const gains = selectDeviceAudioGains(devices.toReversed(), { x: -50, y: -50, width: 100, height: 100 });
//     expect([...gains.entries()]).toEqual(devices.slice(0, 20).map((device, index) => [device.entity.id, index < 10 ? 1 : 0.2]));
//     for (const device of devices.slice(20)) expect(gains.has(device.entity.id)).toBe(false);
//   });
//
//   it("reserves full volume for visible devices even when offscreen devices are nearer", () => {
//     const visible = Array.from({ length: 11 }, (_, index) => deviceAt(`visible-${index}`, 20 + index));
//     const outside = Array.from({ length: 14 }, (_, index) => deviceAt(`outside-${index}`, 0, 2 + index));
//     const gains = selectDeviceAudioGains([...visible, ...outside], { x: -50, y: -1, width: 100, height: 2 });
//     expect([...gains.entries()]).toEqual([
//       ...visible.slice(0, 10).map((device) => [device.entity.id, 1]),
//       ...outside.slice(0, 10).map((device) => [device.entity.id, 0.2]),
//     ]);
//     expect(gains.has("visible-10")).toBe(false);
//   });
//
//   it("limits an entirely offscreen scene to ten quiet devices and never promotes them", () => {
//     const devices = Array.from({ length: 25 }, (_, index) => deviceAt(`outside-${index}`, 10 + index));
//     const gains = selectDeviceAudioGains(devices, { x: -1, y: -1, width: 2, height: 2 });
//     expect([...gains.entries()]).toEqual(devices.slice(0, 10).map((device) => [device.entity.id, 0.2]));
//     expect(selectDeviceAudioGains([], { x: 0, y: 0, width: 1, height: 1 }).size).toBe(0);
//   });
//
//   it("uses footprint centers, includes partially visible devices and breaks distance ties by ID", () => {
//     const devices = [deviceAt("large", -20, -1, 40, 2), deviceAt("small", 1, -1, 2, 2), deviceAt("edge", 4, -1, 4, 2)];
//     expect([...selectDeviceAudioGains(devices.toReversed(), { x: -5, y: -5, width: 10, height: 10 }).keys()])
//       .toEqual(["large", "small", "edge"]);
//     const tied = Array.from({ length: 22 }, (_, index) => deviceAt(`tie-${String(index).padStart(2, "0")}`, -1, -1, 2, 2));
//     const forward = selectDeviceAudioGains(tied, { x: -5, y: -5, width: 10, height: 10 });
//     expect(selectDeviceAudioGains(tied.toReversed(), { x: -5, y: -5, width: 10, height: 10 })).toEqual(forward);
//     expect([...forward.keys()]).toEqual(tied.slice(0, 20).map((device) => device.entity.id));
//   });
//
//   it("reclassifies devices when the viewport moves and removes the former nearest devices", () => {
//     const devices = Array.from({ length: 40 }, (_, index) => deviceAt(`device-${index}`, index * 3, -0.5));
//     const left = selectDeviceAudioGains(devices, { x: -20, y: -20, width: 40, height: 40 });
//     const right = selectDeviceAudioGains(devices, { x: 90, y: -20, width: 40, height: 40 });
//     expect(left.get("device-0")).toBe(1);
//     expect(right.has("device-0")).toBe(false);
//     expect(right.get("device-36")).toBe(1);
//     expect([...right.values()].filter((gain) => gain === 0.2)).toHaveLength(10);
//   });
// });
//
// describe("设备音频交付与动作映射", () => {
//   it("publishes hash-addressed MP3 files with exact byte sizes and a valid manifest", () => {
//     const manifest = parseDeviceAudioManifest(raw);
//     expect(Object.keys(manifest.definitions).length).toBeGreaterThan(40);
//     for (const [hash, clip] of Object.entries(manifest.clips)) {
//       const data = readFileSync(`public/${clip.path}`);
//       expect(data.length).toBe(clip.bytes);
//       expect(createHash("sha256").update(data).digest("hex")).toBe(hash);
//     }
//     expect(manifest.definitions.shaper_1?.working?.loop).toBe(true);
//     expect(manifest.definitions.sp_hub_1?.working?.loop).toBe(false);
//     expect(manifest.definitions.transmuter_1?.working).toBeUndefined();
//     expect(manifest.definitions.transmuter_2?.working).toBeUndefined();
//     expect(manifest.definitions.dumper_1?.build).toBeDefined();
//     expect(manifest.definitions.miner_2?.build).toBeDefined();
//     expect(manifest.definitions.pipe_splitter).toBeUndefined();
//   });
//
//   it("rejects external paths, unavailable clips and invalid loop bounds", () => {
//     const valid = parseDeviceAudioManifest(raw);
//     const hash = Object.keys(valid.clips)[0]!;
//     expect(() => parseDeviceAudioManifest({ ...valid, clips: {
//       ...valid.clips, [hash]: { ...valid.clips[hash], path: "https://other.example/audio.mp3" },
//     } })).toThrow("Invalid audio clip");
//     const binding = valid.definitions.shaper_1!.working!;
//     for (const override of [{ clip: "missing" }, { loopEnd: Infinity }, { loopStart: -1 }, { loopEnd: 0 }]) {
//       expect(() => parseDeviceAudioManifest({ ...valid, definitions: { shaper_1: { working: { ...binding, ...override } } } }))
//         .toThrow("Invalid audio state binding");
//     }
//   });
//
//   it("uses committed entity IDs and only routes supported successful edit kinds", () => {
//     const before = createWorldDocument();
//     const entity: WorldEntity = { id: "committed", definitionId: "shaper_1", position: { x: 0, y: 0 }, rotation: 0, config: {}, tags: [] };
//     const after = { ...before, entities: { committed: entity }, entityOrder: [entity.id] };
//     const record: EditorHistoryRecord = {
//       schemaVersion: 2, id: "record", createdAt: "2026-09-26", documentKey: before.documentKey, sequence: 1,
//       action: { type: "entity.place", label: "place", entityIds: ["draft"] },
//       delta: createWorldDocumentDelta(before, after)!,
//     };
//     expect(resolveCommittedAudio(record)).toEqual({ state: "build", entities: [entity] });
//     expect(resolveCommittedAudio({ ...record, action: { type: "entity.delete", label: "delete" },
//       delta: createWorldDocumentDelta(after, before)! })).toEqual({ state: "remove", entities: [entity] });
//     for (const type of ["document.restore", "document.unknown", "entity.move", "entity.rotate", "entity.config.patch"] as const) {
//       expect(resolveCommittedAudio({ ...record, action: { type, label: type } })).toBeNull();
//     }
//   });
// });
