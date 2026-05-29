// AI-REMOVED 2026-05-28:
// Reason: 该文件是纯测试辅助工具，不应放在 src/editor 生产模块中。
// Trigger: 将测试辅助代码从生产模块移入 src/tests/。
// Evidence: createDummyWorldDocument 仅在 src/tests/ 下的 12 个测试文件中被引用，
//   src/editor、src/app、src/domain、src/renderer、src/simulation 中无任何生产代码依赖它。
// Replacement: src/tests/helpers/dummy-document.ts
// Risk: Low
// Human Review: Not Required
//
// Original code:
// import {
//   DEFAULT_WORLD_BASE_ID,
//   type WorldDocument,
// } from "@/domain/document/world-document";
//
// export function createDummyWorldDocument(): WorldDocument {
//   return {
//     schemaVersion: 1,
//     documentKey: "11111111-1111-4111-8111-111111111111",
//     baseId: DEFAULT_WORLD_BASE_ID,
//     meta: {
//       id: "dummy-world",
//       name: "Dummy World",
//       createdAt: new Date(0).toISOString(),
//       updatedAt: new Date(0).toISOString(),
//     },
//     entities: {
//       "dummy-entity-1": {
//         id: "dummy-entity-1",
//         definitionId: "belt_straight_1x1",
//         position: { x: 12, y: 8 },
//         rotation: 0, config: {}, tags: [],
//       },
//       "dummy-entity-2": {
//         id: "dummy-entity-2",
//         definitionId: "item_port_storager_1",
//         position: { x: 4, y: 4 },
//         rotation: 0, config: {}, tags: [],
//       },
//       "dummy-entity-3": {
//         id: "dummy-entity-3",
//         definitionId: "item_port_grinder_1",
//         position: { x: 10, y: 4 },
//         rotation: 0, config: {}, tags: [],
//       },
//       "dummy-entity-4": {
//         id: "dummy-entity-4",
//         definitionId: "item_port_mix_pool_1",
//         position: { x: 16, y: 3 },
//         rotation: 0, config: {}, tags: [],
//       },
//       "dummy-entity-5": {
//         id: "dummy-entity-5",
//         definitionId: "item_port_liquid_filling_pd_mc_1",
//         position: { x: 24, y: 4 },
//         rotation: 0, config: {}, tags: [],
//       },
//       "dummy-entity-6": {
//         id: "dummy-entity-6",
//         definitionId: "item_log_splitter",
//         position: { x: 14, y: 10 },
//         rotation: 90, config: {}, tags: [],
//       },
//       "dummy-entity-7": {
//         id: "dummy-entity-7",
//         definitionId: "pipe_straight_1x1",
//         position: { x: 20, y: 11 },
//         rotation: 0, config: {}, tags: [],
//       },
//       "dummy-entity-8": {
//         id: "dummy-entity-8",
//         definitionId: "item_port_udpipe_loader_1",
//         position: { x: 26, y: 10 },
//         rotation: 180, config: {}, tags: [],
//       },
//     },
//     entityOrder: [
//       "dummy-entity-2", "dummy-entity-3", "dummy-entity-4", "dummy-entity-5",
//       "dummy-entity-1", "dummy-entity-6", "dummy-entity-7", "dummy-entity-8",
//     ],
//     slotLinks: [],
//     documentSettings: {
//       viewport: { center: { x: 0, y: 0 }, gridSize: 1, displayRotation: 0 },
//       gridSize: 1,
//       showDiagnostics: false,
//     },
//   };
// }
