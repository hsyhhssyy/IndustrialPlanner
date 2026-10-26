
// AI-REMOVED 2026-10-26:
// Reason: 测试仅覆盖 beta1/2 之后加入且本次撤下的局部修复、容量评分、子网或连接采样分支。
// Trigger: 用户明确要求恢复 beta1/2 搜索内核，保留业务修复与任务接口。
// Evidence: src/tests/blueprint-planner/forced-turn-capacity.test.ts；原文件 SHA256 2055aa9a0bcec217360e2666320947858f8818314dc1b886aa5d5286e67fce08。
// Replacement: beta1/2 内核的现有几何、Worker、任务与正式验产测试；search-policy.test.ts 验证新面积公式。
// Risk: 撤下的搜索分支不再参与运行，其专用覆盖同时退休；未修改现有业务正确性门槛。
// Human Review: Required
// Original code:
// // @vitest-environment node
// // 2026-10-21：必转弯端点不能供其他同种线路桥接；单格直行仍允许桥接。
// // 依据：.docs/common/eda/算法探索/算法探索20261021-通用布线进展与搜索预算.md，Windows probe224。
// import { expect, it } from "vitest";
// import { countPlannerRoutingConstraints } from "@/blueprint-planner/routing-capacity";
// import { PlannerRoutingGrid } from "@/blueprint-planner/routing-grid";
// import { DELTAS, EDGES, type PlannerPort } from "@/blueprint-planner/geometry";
//
// function port(id: string, direction: PlannerPort["direction"], kind: PlannerPort["kind"],
//   x: number, y: number, edge: PlannerPort["edge"]): PlannerPort {
//   const delta = DELTAS[EDGES.indexOf(edge)]!;
//   return { entityId: id, direction, kind, groupIndex: 0, portIndex: 0, edge,
//     outside: { x, y }, cell: { x: x - delta.x, y: y - delta.y } };
// }
//
// for (const kind of ["belt", "pipe"] as const) {
//   it(`${kind} 三条线路各自可达，必转弯端点使它们不能同时通过`, () => {
//     const grid = new PlannerRoutingGrid();
//     const wires = [
//       { source: port("s0", "output", kind, 0, 9, "NORTH"), target: port("t0", "input", kind, 1, 4, "SOUTH") },
//       { source: port("s1", "output", kind, 6, 9, "NORTH"), target: port("t1", "input", kind, 2, 4, "SOUTH") },
//       { source: port("s2", "output", kind, 2, 0, "NORTH"), target: port("t2", "input", kind, 3, 2, "WEST") },
//     ];
//     // 几何独立于产品 ID；Windows 中三线约束不可满足，所有两线子集均已由真实 Router 布通。
//     for (const box of [{ x: 0, y: 1, width: 3, height: 3 }, { x: 4, y: 2, width: 2, height: 6 },
//       { x: 1, y: 5, width: 3, height: 3 }]) {
//       for (let y = box.y; y < box.y + box.height; y++) for (let x = box.x; x < box.x + box.width; x++) {
//         grid.block(grid.cell(x, y), kind === "belt" ? 2 : 1);
//       }
//     }
//     for (const wire of wires) for (const endpoint of [wire.source, wire.target]) {
//       grid.reserve(grid.cell(endpoint.outside.x, endpoint.outside.y), kind === "belt" ? 0 : 1, EDGES.indexOf(endpoint.edge));
//     }
//     const bounds = { x: 0, y: 0, width: 7, height: 10 };
//     expect(countPlannerRoutingConstraints(grid, wires, bounds)).toEqual({ disconnectedWires: 0, capacityDeficit: 1 });
//     for (let removed = 0; removed < wires.length; removed++) {
//       expect(countPlannerRoutingConstraints(grid, wires.filter((_, index) => index !== removed), bounds))
//         .toEqual({ disconnectedWires: 0, capacityDeficit: 0 });
//     }
//   });
//
//   it(`${kind} 同外格的单格直行不会被对端主体误判为必转弯`, () => {
//     const grid = new PlannerRoutingGrid();
//     grid.block(grid.cell(0, 1), kind === "belt" ? 2 : 1);
//     grid.block(grid.cell(2, 1), kind === "belt" ? 2 : 1);
//     const wires = [
//       { source: port("h0", "output", kind, 1, 1, "EAST"), target: port("h1", "input", kind, 1, 1, "WEST") },
//       { source: port("v0", "output", kind, 1, 0, "SOUTH"), target: port("v1", "input", kind, 1, 2, "NORTH") },
//     ];
//     for (const wire of wires) for (const endpoint of [wire.source, wire.target]) {
//       grid.reserve(grid.cell(endpoint.outside.x, endpoint.outside.y), kind === "belt" ? 0 : 1, EDGES.indexOf(endpoint.edge));
//     }
//     expect(countPlannerRoutingConstraints(grid, wires, { x: 0, y: 0, width: 3, height: 3 }))
//       .toEqual({ disconnectedWires: 0, capacityDeficit: 0 });
//   });
// }
//
