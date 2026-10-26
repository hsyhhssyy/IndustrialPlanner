
// AI-REMOVED 2026-10-26:
// Reason: 用户要求恢复 beta1/2 搜索内核，撤回其后搜索实现；保留业务正确性修复与公开任务接口。
// Trigger: 多版本对照后用户明确要求回退算法并使用 2S 渐增至 3S 初始面积。
// Evidence: .temp/eda/all-items/comparisons/default-area-20261026T015057315Z.json；回退前 SHA256 6bff2017cb81ba987504597f5b14f04eaf6bc0cf59dbfac77247bf99dfb512be。
// Replacement: None；功能随 beta1/2 搜索内核回退撤下
// Risk: 搜索策略、检查点及后续局部修复能力变化；原始未提交内容完整保留。
// Human Review: Required
// Original code (src/blueprint-planner/route-repair.ts):
// // AI-CORRECTION 2026-10-23：Windows787原供电587次、788完整排序19/19、789原缩边通过后采用first-solution-66；下方“隔离/尚未采用”为此前阶段说明。
// // AI-CORRECTION 2026-10-23：本文件为v65之上的隔离双快照对照，尚未采用为产品版本。
// // AI-CORRECTION 2026-10-23：Windows782/783真实对照后采用first-solution-65；下方审计“隔离原型”指采用前历史阶段。
// import type { RegistryContract } from "@/domain/registry/registry-contract";
// import type { GridRotation } from "@/domain/shared/grid";
// import { areGridRectsIntersecting, resolveEntityGridRect } from "@/shared/geometry/power-range";
// import { allowsPlannerOverlap } from "./geometry";
// import { CompactLayoutSearch } from "./compact-layout";
// import { PlannerCandidateError, type PlannerNetwork, type PlannerWire } from "./model";
// import { PlannerRandom } from "./search-random";
// import { PlannerRouter } from "./router";
// import type { PlannerSearchProfile } from "./search-profile";
// import type { PlannerSearchStatistics } from "./search-types";
// import { yieldPlannerTask } from "./yield-task";
// import { comparePlannerPartialSeeds, plannerPartialRank } from "./search-seed";
// import { plannerPortAssignmentGroups, plannerPortKey, proposePlannerPortKeys } from "./port-assignment";
// // AI-REMOVED 2026-10-20:
// // Reason: 端口对齐重定位在本地六轮均未改善连通率，撤回独立实验，避免无收益叠加。
// // Trigger: v24 的 24/25 布局在六轮各 8000 次 v25 修复后仍为 24/25。
// // Evidence: .temp/playwright-test/eda-fixed-area-20261020/local-repair-v25/
// // Replacement: 保留下方原有移动；后续改为修复跨长宽比的指导池淘汰。
// // Risk: 仅为该布局的局部诊断，不能证明这种提案普遍无效。Human Review: Required
// // Original code:
// // import { getPlannerPorts, opposite, ROTATIONS } from "./geometry";
//
// /** 首解的未完成网表按真实连通率修复；几何、路径和最终产量仍使用共同裁判。 */
// // AI-CORRECTION 2026-10-20：缩面积阶段的未完成网表也使用同一修复流程，完整成果继续交由布局搜索压缩。
// export async function repairPlannerRoutes(registry: RegistryContract, network: PlannerNetwork, wires: PlannerWire[],
//   initialRoutes: PlannerRouter["routes"], statistics: PlannerSearchStatistics, profile: PlannerSearchProfile,
//   limit: number, checkBudget: () => void, maximumEvaluations = statistics.evaluationLimit): Promise<PlannerRouter["routes"] | undefined> {
//   // 2026-10-21：完整缓存也可能被新预留的桩位阻挡，必须经过当前网表的重放后才判断是否需要修复。
//   if (!initialRoutes.length || network.request.blueprintSource || network.slotLinks.some(link => network.nodes.some(node => node.entity.id === link.source.entityId)
//     && network.nodes.some(node => node.entity.id === link.target.entityId))) return initialRoutes;
//   // AI-REMOVED 2026-10-20:
//   // Reason: 持续修复实验未达首解要求，收敛回已取得首解的局部修复组织。
//   // Trigger: Windows sustained-repair-v20 固定 2S、20M 无首解。
//   // Evidence: 最好连通 24/25；footprint-exchange-v19 在 13,197,760 次取得 342 格有效首解。
//   // Replacement: 本函数下方逐提案几何检查，以及 candidate.ts 的有界修复份额。
//   // Risk: 不能将预算和入口限制的组合实验解释为其中单一变量的独立结论。
//   // Human Review: Required
//   // Original code:
//   // // 2026-10-20：只对当前盒子内已合法的摆位做连通修复；缩边造成的几何违例交回布局搜索。
//   // const initialStatistics: PlannerSearchStatistics = { seed: statistics.seed, evaluationLimit: 1, evaluations: 0, acceptedMoves: 0,
//   //   routingAttempts: 0, initialWireLength: 0, finalWireLength: 0, outline: statistics.outline, strategy: "compact" };
//   // if (!await new CompactLayoutSearch(registry, network, wires, initialStatistics, profile).advance(0, checkBudget)) return initialRoutes;
//   // 2026-10-21：入口与移动提案共用几何裁判；跨尺寸的非法摆位交回布局搜索，undefined 表示没有可发布的修复快照。
//   // 2026-10-21：多个缩边入口共用统计对象；各入口的绝对截止计数与外层硬顶同时生效。
//   const repairCeiling = Math.min(statistics.evaluationLimit, maximumEvaluations);
//   let disconnectedWires = 0, capacityDeficit = 0;
//   const applyLegalLayout = async () => {
//     const local: PlannerSearchStatistics = { seed: statistics.seed, evaluationLimit: 1, evaluations: 0, acceptedMoves: 0,
//       routingAttempts: 0, initialWireLength: 0, finalWireLength: 0, outline: statistics.outline, strategy: "compact" };
//     const layout = new CompactLayoutSearch(registry, network, wires, local, profile);
//     // 2026-10-21：静态断连本身就是待修复目标，允许作为部分状态；碰撞、越界、端口占用和供电缺口仍立即拒绝。
//     const feasible = await layout.advance(0, checkBudget);
//     const conflicts = local.remainingConflicts;
//     if (!feasible && (!conflicts || conflicts.geometry || conflicts.boundary || conflicts.power)) return false;
//     layout.applyBest();
//     disconnectedWires = feasible ? 0 : conflicts!.connections;
//     // AI-REMOVED 2026-10-21:
//     // Reason: 供电覆盖必须进入共同几何搜索，不能只在路径修复后单独拒绝。
//     // Trigger: Windows probe39 预留桩位造成 3–5 条静态断连，需要先移动设备/桩位恢复几何可达。
//     // Evidence: probe39 六组供电方案均无碰撞、越界，但存在 disconnected 违例。
//     // Replacement: CompactLayoutSearch.checkPower，CPU 与数值后端共用。
//     // Risk: 含真实供电桩的生成网表新增覆盖约束；Human Review: Required。
//     // Original code:
//     // // 2026-10-21：协同修复中的电桩是真实占地；移动设备或桩位后仍须覆盖全部需电设备。
//     // if (network.nodes.some(node => node.purpose === "power")) {
//     //   const powered = collectPoweredEntityIds(network.nodes.map(node => node.entity), registry.entityDefinitions);
//     //   if (network.nodes.some(node => node.definition.requiresPower && !powered.has(node.entity.id))) return false;
//     // }
//     // 2026-10-21：几何检查与后续线路重放共用这份 Router；容量事实同时进入快照和回退。
//     const router = new PlannerRouter(registry, network.nodes.map(node => node.entity), wires.flatMap(wire => [wire.source, wire.target]),
//       { minimumX: 0, minimumY: 0, maximumX: statistics.outline.width - 1, maximumY: statistics.outline.height - 1, escapeLength: 0 });
//     // 2026-10-23：每个局部提案使用格网/轴下界与实际重布评分；昂贵成对定价在返回快照时统一复核。
//     // 原返回口仍提供完整必要事实，最终Router/供电/Dense条件不变；避免每次移动重复执行32轮全网最短路。
//     // AI-CORRECTION 2026-10-23：潜在历史最优与周期回退也先核对完整事实；每个普通提案的局部能量仍沿原轴代理。
//     // AI-CORRECTION 2026-10-23：v66完整事实用于成果最优/续窗/发布；周期回退恢复独立探索代理最优，避免与原局部能量不同序。
//     const constraints = router.axisConstraints(wires);
//     disconnectedWires = Math.max(disconnectedWires, constraints.disconnectedWires);
//     capacityDeficit = constraints.capacityDeficit;
//     return router;
//   };
//   // 2026-10-23：完整保留事实组合原CPU/轴代理与完整Router必要下界；两个缺口取max，不重复累加同一瓶颈。
//   const completeConstraints = (router: PlannerRouter) => {
//     const full = router.staticConstraints(wires);
//     const disconnected = Math.max(disconnectedWires, full.disconnectedWires);
//     // AI-CORRECTION 2026-10-23：CPU方向断连与轴容量证据可能覆盖同一线路；完整总缺口以max合并，局部旧能量仍保持。
//     // AI-REMOVED 2026-10-23:
//     // Reason: 原CPU/轴代理的合计可能重复同一失败线路，不能作为完整缺口的额外加数。
//     // Trigger: 采用前的完整事实语义审计；原781实现尚未合入产品。
//     // Evidence: 完整Router已经含全部轴容量；另需保留的是更强CPU方向断连。
//     // Replacement: 下方max(已知方向断连,完整Router总缺口)。
//     // Risk: 仅完整保留语义；局部接受/能量不变；Human Review: Required
//     // Original code:
//     // const total = Math.max(disconnectedWires + capacityDeficit, full.disconnectedWires + full.capacityDeficit);
//     const total = Math.max(disconnectedWires, full.disconnectedWires + full.capacityDeficit);
//     return { disconnectedWires: disconnected, capacityDeficit: total - disconnected };
//   };
//   const poseRandom = new PlannerRandom((statistics.seed ^ 0x738ac521) >>> 0 || 1);
//   // 2026-10-23：显式端口提案复用匹配随机身份，避免新增端口动作消耗摆位/接受流，破坏原种子的几何探索。
//   const portRandom = new PlannerRandom((statistics.attemptStrategy?.matchingSeed ?? statistics.seed) >>> 0 || 1);
//   const nodes = new Map(network.nodes.map(node => [node.entity.id, node]));
//   const key = (wire: PlannerWire) => `${wire.source.entityId}/${wire.source.groupIndex}/${wire.source.portIndex}>${wire.target.entityId}/${wire.target.groupIndex}/${wire.target.portIndex}`;
//   const routeKey = (route: PlannerRouter["routes"][number]) => `${route.sourcePort}>${route.targetPort}`;
//   // 2026-10-23：本函数仅替换位置、朝向及config顶层字段；restrictPort写入全新的规则对象，不修改嵌套值。
//   // 快照复制这些可写层，保留只读配置值；避免逐提案深拷贝整份配方和端口规则。
//   const copyEntity = (entity: PlannerNetwork["nodes"][number]["entity"]) => ({ ...entity,
//     position: { ...entity.position }, config: { ...entity.config } });
//   const snapshot = () => ({ entities: network.nodes.map(node => copyEntity(node.entity)), wires: wires.slice(), disconnectedWires, capacityDeficit });
//   const restore = (value: ReturnType<typeof snapshot>) => {
//     network.nodes.forEach((node, index) => Object.assign(node.entity, copyEntity(value.entities[index]!)));
//     wires.splice(0, wires.length, ...value.wires);
//     disconnectedWires = value.disconnectedWires;
//     capacityDeficit = value.capacityDeficit;
//   };
//   // 2026-10-21：平移碰到主体时同步推动阻挡设备，允许穿越逐个移动无法跨越的紧密排列；完整几何检查仍决定合法性。
//   const translate = (moving: Set<string>, axis: "x" | "y", delta: number) => {
//     // AI-REMOVED 2026-10-21:
//     // Reason: 仅主体碰撞传播无法同步移开被端口占位阻挡的关联设备。
//     // Trigger: v49 软饮三线共同冲突无法由任一单节点移动或原主体推动解除。
//     // Evidence: Windows probe219 / probe220；组合评分在 probe221 的 367 次内恢复全通。
//     // Replacement: 下方同时检查主体、已用端口和端口争格的平移闭包。
//     // Risk: 推动集合可能扩大并增加越界拒绝；仍由完整几何与真实 Router 验证。
//     // Human Review: Required
//     // Original code:
//     // for (const id of moving) {
//     //   const node = nodes.get(id)!;
//     //   node.entity.position = { ...node.entity.position, [axis]: node.entity.position[axis] + delta };
//     //   const rect = resolveEntityGridRect({ entity: node.entity, definition: node.definition });
//     //   for (const other of network.nodes) {
//     //     if (moving.has(other.entity.id) || allowsPlannerOverlap(registry, node.definition, other.definition)) continue;
//     //     if (areGridRectsIntersecting(rect, resolveEntityGridRect({ entity: other.entity, definition: other.definition }))) {
//     //       moving.add(other.entity.id);
//     //     }
//     //   }
//     // }
//     // 2026-10-21：先在虚拟位置上求同向推动闭包，再一次应用，避免部分移动污染端口判断。
//     const initial = new Map(network.nodes.map(node => [node.entity.id,
//       resolveEntityGridRect({ entity: node.entity, definition: node.definition })]));
//     const usedPorts = new Map<string, Array<{ wireIndex: number; port: PlannerWire["source"] }>>();
//     wires.forEach((wire, wireIndex) => { for (const port of [wire.source, wire.target]) {
//       const group = usedPorts.get(port.entityId) ?? []; group.push({ wireIndex, port }); usedPorts.set(port.entityId, group);
//     }});
//     const tracks = { belt: registry.queries.findEntityDefinition(registry.queries.resolveLogisticsDefinitionId("belt", "straight"))!,
//       pipe: registry.queries.findEntityDefinition(registry.queries.resolveLogisticsDefinitionId("pipe", "straight"))! };
//     const inside = (rect: { x: number; y: number; width: number; height: number }, p: { x: number; y: number }) =>
//       p.x >= rect.x && p.y >= rect.y && p.x < rect.x + rect.width && p.y < rect.y + rect.height;
//     const position = (port: PlannerWire["source"], field: "cell" | "outside") =>
//       ({ ...port[field], [axis]: port[field][axis] + (moving.has(port.entityId) ? delta : 0) });
//     const direct = (wireIndex: number) => {
//       const wire = wires[wireIndex]!;
//       if ((wire.minimumCells ?? 0) !== 0 || !(registry.queries.isGeneralLogisticsDevice(nodes.get(wire.source.entityId)!.definition.id)
//         || registry.queries.isGeneralLogisticsDevice(nodes.get(wire.target.entityId)!.definition.id))) return false;
//       const a = position(wire.source, "outside"), b = position(wire.target, "cell");
//       const c = position(wire.target, "outside"), d = position(wire.source, "cell");
//       return a.x === b.x && a.y === b.y && c.x === d.x && c.y === d.y;
//     };
//     for (const id of moving) {
//       const node = nodes.get(id)!, base = initial.get(id)!, rect = { ...base, [axis]: base[axis] + delta };
//       for (const other of network.nodes) {
//         if (moving.has(other.entity.id)) continue;
//         const otherRect = initial.get(other.entity.id)!;
//         const ownPorts = (usedPorts.get(id) ?? []).filter(entry => !direct(entry.wireIndex));
//         const otherPorts = (usedPorts.get(other.entity.id) ?? []).filter(entry => !direct(entry.wireIndex));
//         const body = !allowsPlannerOverlap(registry, node.definition, other.definition) && areGridRectsIntersecting(rect, otherRect);
//         const ownPortBlocked = ownPorts.some(entry => inside(otherRect, position(entry.port, "outside"))
//           && !allowsPlannerOverlap(registry, other.definition, tracks[entry.port.kind]));
//         const otherPortBlocked = otherPorts.some(entry => inside(rect, position(entry.port, "outside"))
//           && !allowsPlannerOverlap(registry, node.definition, tracks[entry.port.kind]));
//         const competition = ownPorts.some(a => otherPorts.some(b => a.wireIndex !== b.wireIndex && a.port.kind === b.port.kind
//           // 2026-10-21：同格正交端口能够桥接，不因端点共格而强制同步推动另一台设备。
//           && (a.port.outside.x !== a.port.cell.x) === (b.port.outside.x !== b.port.cell.x)
//           && position(a.port, "outside").x === position(b.port, "outside").x
//           && position(a.port, "outside").y === position(b.port, "outside").y));
//         if (body || ownPortBlocked || otherPortBlocked || competition) {
//           moving.add(other.entity.id);
//         }
//       }
//     }
//     for (const id of moving) {
//       const entity = nodes.get(id)!.entity; entity.position = { ...entity.position, [axis]: entity.position[axis] + delta };
//     }
//   };
//   const score = (routes: PlannerRouter["routes"]) => {
//     // AI-REMOVED 2026-10-21:
//     // Reason: 仅计未接线路会偏爱距离很短但被设备完全隔断的状态，统一部分进展评分。
//     // Trigger: v37 最佳 31/32 在移除其他线路后仍静态不可达。
//     // Evidence: Windows probe52；Replacement: search-seed.ts plannerPartialRank。
//     // Risk: 部分状态排序改变，须以同预算 Windows 冷启动验证；Human Review: Required。
//     // Original code:
//     // const connected = new Set(routes.map(routeKey));
//     // return (wires.length - routes.length) * 100 + wires.reduce((sum, wire) => sum
//     //   + (Math.abs(wire.source.outside.x - wire.target.outside.x) + Math.abs(wire.source.outside.y - wire.target.outside.y))
//     //     * (connected.has(key(wire)) ? 0.05 : 1), 0);
//     const rank = plannerPartialRank({ network, wires, routes, disconnectedWires, capacityDeficit });
//     // AI-REMOVED 2026-10-22:
//     // Reason: 排序首项改为静态可行性，不能继续解释为原退火总缺口。
//     // Trigger: 共享部分状态排序修正。
//     // Evidence: Windows probe533～534 保持原能量与温度的对照。
//     // Replacement: 下方显式总缺口能量；确定性保留仍用共享排序。
//     // Risk: Low；Human Review: Required
//     // Original code:
//     // return (rank[0] * 100 + rank[3]) * wires.length;
//     const totalDeficit = (wires.length - routes.length + disconnectedWires + capacityDeficit) / Math.max(1, wires.length);
//     return (totalDeficit * 100 + rank[3]) * wires.length;
//   };
//   // 绑定启动根及库存的连接不能作为等价物料配对；普通生产及同流量分流边才允许换目标。
//   const reassignable = (wire: PlannerWire) => {
//     const source = nodes.get(wire.source.entityId)!, target = nodes.get(wire.target.entityId)!;
//     return !wire.minimumCells && source.purpose !== "startup" && target.purpose !== "startup"
//       && !source.supplyTarget && !source.outputSource && !target.supplyTarget && !target.outputSource
//       && !target.inputs.some(input => input.sourceEntityIds?.length);
//   };
//   const incoming = snapshot();
//   let routes: PlannerRouter["routes"];
//   let initialComplete: ReturnType<typeof completeConstraints> | undefined;
//   try {
//     const initialRouter = await applyLegalLayout();
//     if (!initialRouter) { restore(incoming); return undefined; }
//     initialComplete = completeConstraints(initialRouter);
//     // 2026-10-21：旧盒子中的连通数不是新盒子的事实；只以当前端口、边界和占用下仍合法的缓存建立评分基线。
//     // AI-REMOVED 2026-10-21:
//     // Reason: 复用 applyLegalLayout 创建并检查容量的 Router，避免重复构建相同静态图。
//     // Trigger: Windows probe62/65 确认单线可达仍有共同通道容量缺口。
//     // Evidence: .temp/playwright-test/eda-adaptive-20261021/probe65/。
//     // Replacement: 上方 initialRouter；Risk: 每个提案仍必须使用新实例；Human Review: Required。
//     // Original code:
//     // const initialRouter = new PlannerRouter(registry, network.nodes.map(node => node.entity), wires.flatMap(wire => [wire.source, wire.target]),
//     //   { minimumX: 0, minimumY: 0, maximumX: statistics.outline.width - 1, maximumY: statistics.outline.height - 1, escapeLength: 0 });
//     const initialWires = new Map(wires.map(wire => [key(wire), wire]));
//     for (const route of initialRoutes) {
//       const wire = initialWires.get(routeKey(route));
//       if (!wire) continue;
//       if (route.cells.length) initialRouter.reuse(wire.source, wire.target, route.cells, wire.minimumCells);
//       else {
//         try { await initialRouter.connect(wire.source, wire.target, checkBudget, wire.minimumCells); }
//         catch (error) { if (!(error instanceof PlannerCandidateError)) throw error; }
//       }
//     }
//     routes = initialRouter.routes;
//   } catch (error) {
//     // 2026-10-21：入口检查和零格直连重放同样可能取消，不能留下尚未建立评分基线的端口或配置改动。
//     restore(incoming); throw error;
//   }
//   // AI-REMOVED 2026-10-22:
//   // Reason: 周期回退已统一使用部分状态排序，不再读取旧最佳能量。
//   // Trigger: 可行性优先修正；Evidence: 本函数所有 bestCost 读取均已由共享比较替代。
//   // Replacement: 下方仅保留退火当前能量；Risk: Low；Human Review: Required
//   // Original code:
//   // let bestRoutes = routes, currentCost = score(routes), bestCost = currentCost;
//   let bestRoutes = routes, currentCost = score(routes);
//   let mostRouted = routes.length;
//   statistics.bestRoutedWireCount = Math.max(statistics.bestRoutedWireCount ?? 0, mostRouted);
//   let blockers = new Map<string, readonly string[]>();
//   let best = snapshot();
//   let bestComplete = initialComplete!;
//   // 2026-10-23：隔离诊断：探索回退沿原廉价代理，完整发布最优独立保留。
//   // AI-CORRECTION 2026-10-23：双快照经Windows控制后采用；探索快照允许必要不可行状态，不作为安全成果发布。
//   let explorationBest = best, explorationRoutes = routes;
//   // 2026-10-21：limit 是无连通改善的完整观察窗口；真实进展续一个窗口，所有次数仍受 evaluationLimit 硬上限约束。
//   // AI-CORRECTION 2026-10-21：最佳状态的静态断连减少也属于真实进展；纯距离改善仍不续期。
//   let stop = Math.min(repairCeiling, statistics.evaluations + limit);
//   // AI-REMOVED 2026-10-21:
//   // Reason: v29/v30 未达到 Windows 20M 首解门槛，撤回预算与入口实验，避免叠加未证实收益的机制。
//   // Trigger: 优质锦草软饮 v29 为 31/32、v30 为 30/32，均无首解。
//   // Evidence: .temp/playwright-test/eda-adaptive-20261021/v29/ 与 v30/。
//   // Replacement: 恢复 stop 有界修复；本轮只改变平移提案的碰撞处理。
//   // Risk: 仅说明当前组合未通过，不能证明其他任务无收益。
//   // Human Review: Required
//   // Original code:
//   // // 2026-10-21：以节点和连接规模给出观察窗口；只有超过历史最好连通数才续期，微小距离改善不延长搜索。
//   // const patience = Math.min(limit, Math.max(256, 32 * (network.nodes.length + wires.length)));
//   // let lastConnectionImprovement = statistics.evaluations;
//   let step = 0;
//   try {
//     while (statistics.evaluations < stop && bestRoutes.length < wires.length) {
//       checkBudget();
//       // AI-REMOVED 2026-10-22:
//       // Reason: 低退火能量的不可行状态可能不回到共享排序认定的安全最佳状态。
//       // Trigger: 可行性优先与原退火能量采用不同顺序。
//       // Evidence: Windows probe532 退回容量不足状态，probe533 保留安全入口。
//       // Replacement: 下方按共享部分排序进行周期回退。
//       // Risk: 搜索轨迹改变；Human Review: Required
//       // Original code:
//       // if (step > 0 && step % 500 === 0 && currentCost > bestCost + 10) {
//       // AI-REMOVED 2026-10-23:
//       // Reason: 周期回退也必须按完整必要事实比较，不能用较弱代理保留已证不安全的当前状态。
//       // Trigger: 780真实新供电态1685已接受中1666代理/完整容量不同，33/35完整0被34/35完整1覆盖。
//       // Evidence: 780只读与779最终计数/search/snapshot逐项相同，完整旁观最优被丢弃。
//       // Replacement: 下方完整事实确认后的保留与回退；局部接受/能量仍使用旧代理。
//       // Risk: 增加潜在最优确认开销，原额度/PRNG/物理门槛保持；目前隔离原型。
//       // Human Review: Required
//       // Original code:
//       // if (step > 0 && step % 500 === 0 && comparePlannerPartialSeeds({ network, wires, routes, disconnectedWires, capacityDeficit },
//       //   { network, wires: best.wires, routes: bestRoutes, disconnectedWires: best.disconnectedWires, capacityDeficit: best.capacityDeficit }) > 0) {
//       //   restore(best); routes = bestRoutes; blockers.clear(); currentCost = score(routes);
//       // }
//       // AI-REMOVED 2026-10-23:
//       // Reason: 验证探索周期回退与完整成果保留是否需要各自的最优快照，避免改变原探索轨迹。
//       // Trigger: Windows785同原搜索输入21983次，旧744为587次；提案数增加原因尚待本隔离对照验证。
//       // Evidence: 785/744均原60k与相同冷却/策略，仿真窗口差异只在搜索之后。
//       // Replacement: 下方原代理周期回退；完整最优确认/续窗/发布继续保持v65。
//       // Risk: 两份快照的职责必须明确；仅隔离诊断，不视为已确认修复。
//       // Human Review: Required
//       // Original code:
//       //       if (step > 0 && step % 500 === 0) {
//       //         const currentRouter = new PlannerRouter(registry, network.nodes.map(node => node.entity), wires.flatMap(wire => [wire.source, wire.target]),
//       //           { minimumX: 0, minimumY: 0, maximumX: statistics.outline.width - 1, maximumY: statistics.outline.height - 1, escapeLength: 0 });
//       //         if (comparePlannerPartialSeeds({ network, wires, routes, ...completeConstraints(currentRouter) },
//       //           { network, wires: best.wires, routes: bestRoutes, ...bestComplete }) > 0) {
//       //           restore(best); routes = bestRoutes; blockers.clear(); currentCost = score(routes);
//       //         }
//       //       }
//       if (step > 0 && step % 500 === 0 && comparePlannerPartialSeeds({ network, wires, routes, disconnectedWires, capacityDeficit },
//         { network, wires: explorationBest.wires, routes: explorationRoutes,
//           disconnectedWires: explorationBest.disconnectedWires, capacityDeficit: explorationBest.capacityDeficit }) > 0) {
//         restore(explorationBest); routes = explorationRoutes; blockers.clear(); currentCost = score(routes);
//       }
//       const usePortProposal = portRandom.integer(5) === 0;
//       const random = usePortProposal ? portRandom : poseRandom;
//       const previous = snapshot(), completed = new Set(routes.map(routeKey));
//       const unfinished = wires.filter(wire => !completed.has(key(wire)));
//       if (!unfinished.length) break;
//       const focus = unfinished[random.integer(unfinished.length)]!;
//       const focusIndex = wires.indexOf(focus);
//       const anchor = nodes.get(random.integer(2) ? focus.source.entityId : focus.target.entityId)!;
//       const nearby = network.nodes.filter(node => Math.abs(node.entity.position.x - anchor.entity.position.x)
//         + Math.abs(node.entity.position.y - anchor.entity.position.y) < 10);
//       const selected = random.integer(2) ? anchor : nearby[random.integer(nearby.length)]!;
//       const blockingRoutes = blockers.get(key(focus)) ?? [];
//       const guided = blockingRoutes.length > 0 && random.integer(2) === 0;
//       const mode = guided ? 0 : random.integer(100);
//       // 2026-10-21：端口变化必须成为独立提案，不能让几何裁判隐式覆盖合法布线。
//       let changedPorts = false;
//       if (!guided && usePortProposal) {
//         const groups = plannerPortAssignmentGroups(registry, network, wires, true);
//         const focused = groups.filter(group => group.edges.includes(focusIndex));
//         const available = focused.length ? focused : groups;
//         const group = available.length ? available[random.integer(available.length)] : undefined;
//         if (group) {
//           const current = group.edges.map(index => plannerPortKey(group.source ? wires[index]!.source : wires[index]!.target));
//           const keys = proposePlannerPortKeys(current, group.keys, () => random.next() / 4294967296);
//           if (keys) {
//             group.edges.forEach((at, index) => {
//               const port = group.ports.find(candidate => plannerPortKey(candidate) === keys[index])!;
//               wires[at] = { ...wires[at]!, [group.source ? "source" : "target"]: port };
//             });
//             changedPorts = true;
//           }
//         }
//       }
//       if (changedPorts) {
//         // 接受、拒绝和线路缓存重放仍由下方共同路径处理。
//       } else if (mode < 10) {
//         // 保留摆位，只重排少量路径；已连通线路也可主动让出拥塞通道。
//       } else if (mode < 20) {
//         const ids = new Set([selected.entity.id, ...wires.filter(wire => wire.source.entityId === selected.entity.id || wire.target.entityId === selected.entity.id)
//           .map(wire => wire.source.entityId === selected.entity.id ? wire.target.entityId : wire.source.entityId).filter(() => random.integer(2) === 0)]);
//         const axis = random.integer(2) ? "x" : "y", delta = random.integer(2) ? 1 : -1;
//         // AI-REMOVED 2026-10-21:
//         // Reason: ids 已由网表节点构造，调用连锁平移无需再次扫描成员。
//         // Trigger: 收敛通用平移实现；Evidence: selected 和关联 wire 的 entityId 均来自 nodes。
//         // Replacement: 下方直接 translate；Risk: Low；Human Review: Required。
//         // Original code:
//         // for (const node of network.nodes) if (ids.has(node.entity.id)) {
//         //   translate(ids, axis, delta);
//         //   break;
//         // }
//         translate(ids, axis, delta);
//       } else if (mode < 45 && reassignable(focus)) {
//         const items = focus.itemIds.slice().sort().join("/");
//         const alternatives = wires.filter(wire => wire !== focus && reassignable(wire) && wire.perMinute === focus.perMinute
//           && wire.source.kind === focus.source.kind && wire.itemIds.slice().sort().join("/") === items
//           && wire.source.entityId !== focus.target.entityId && focus.source.entityId !== wire.target.entityId);
//         if (alternatives.length) {
//           const other = alternatives[random.integer(alternatives.length)]!;
//           wires[wires.indexOf(focus)] = { ...focus, target: other.target };
//           wires[wires.indexOf(other)] = { ...other, target: focus.target };
//         }
//       } else if (mode < 55) selected.entity.rotation = ((selected.entity.rotation + 90) % 360) as GridRotation;
//       // AI-REMOVED 2026-10-20:
//       // Reason: 端口对齐重定位实验未观察到改善，恢复原提案比例。
//       // Trigger: v25 六轮局部诊断仍为 24/25；Evidence: local-repair-v25/。
//       // Replacement: 下方既有移动与交换；Risk: 未作 Windows 冷启动对照。Human Review: Required
//       // Original code:
//       // else if (mode < 60) {
//       //   // 2026-10-20：按失败连接重定位一端，越过逐格移动无法穿越的设备；共同几何检查仍拒绝重叠、越界和断口。
//       //   const source = random.integer(2) === 0, own = source ? focus.source : focus.target, other = source ? focus.target : focus.source;
//       //   const node = nodes.get(own.entityId)!;
//       //   const { rotation, port } = ROTATIONS.map(rotation => ({ rotation,
//       //     port: getPlannerPorts(registry, { ...node.entity, position: { x: 0, y: 0 }, rotation }, node.definition, own.direction)
//       //       .find(port => port.groupIndex === own.groupIndex && port.portIndex === own.portIndex)! }))
//       //     .find(({ port }) => port.edge === opposite(other.edge))!;
//       //   const gap = 1 + random.integer(3), dx = other.outside.x - other.cell.x, dy = other.outside.y - other.cell.y;
//       //   node.entity.position = { x: other.outside.x + dx * gap - port.cell.x, y: other.outside.y + dy * gap - port.cell.y };
//       //   node.entity.rotation = rotation;
//       // }
//       else if (mode < 90) {
//         const axis = random.integer(2) ? "x" : "y";
//         translate(new Set([selected.entity.id]), axis, (random.integer(2) ? 1 : -1) * (random.integer(5) ? 1 : 3));
//       } else {
//         // 2026-10-20：等占地设备可直接交换姿态，越过逐格移动无法穿越的密集局部；端口与边界仍由共同布局检查。
//         const peers = network.nodes.filter(node => node.definition.footprint.width === selected.definition.footprint.width
//           && node.definition.footprint.height === selected.definition.footprint.height);
//         const other = peers[random.integer(peers.length)]!, position = { ...selected.entity.position }, rotation = selected.entity.rotation;
//         selected.entity.position = { ...other.entity.position }; selected.entity.rotation = other.entity.rotation;
//         other.entity.position = position; other.entity.rotation = rotation;
//       }
//       statistics.evaluations++; step++;
//       statistics.routeRepairEvaluations = (statistics.routeRepairEvaluations ?? 0) + 1;
//       // AI-REMOVED 2026-10-21:
//       // Reason: 几何检查统一供入口与移动提案使用，禁止非法初态被当成历史最佳发布。
//       // Trigger: 缩边后仍返回旧的 31 条连通，实际仅 29 条合法且几何非法。
//       // Evidence: Windows probe35 六轮各 4000 次均复现。
//       // Replacement: 本函数 applyLegalLayout。
//       // Risk: 非法初态不再消耗局部修复预算，交回几何搜索；Human Review: Required。
//       // Original code:
//       // const local: PlannerSearchStatistics = { seed: statistics.seed, evaluationLimit: 1, evaluations: 0, acceptedMoves: 0,
//       //   routingAttempts: 0, initialWireLength: 0, finalWireLength: 0, outline: statistics.outline, strategy: "compact" };
//       // const layout = new CompactLayoutSearch(registry, network, wires, local, profile);
//       let accepted = false;
//       const router = await applyLegalLayout();
//       if (router) {
//         // AI-REMOVED 2026-10-21:
//         // Reason: 应用合法摆位已移入共同几何裁判。Trigger: 入口与提案一致性修复。
//         // Evidence: Windows probe35；Replacement: applyLegalLayout；Risk: Low；Human Review: Required。
//         // Original code: layout.applyBest();
//         // AI-REMOVED 2026-10-21:
//         // Reason: 每个合法提案直接使用共同静态检查创建的 Router。
//         // Trigger: 新增通道容量评分；Evidence: Windows probe62/65；Replacement: 上方 router。
//         // Risk: 不跨提案复用动态占用；Human Review: Required。
//         // Original code:
//         // const router = new PlannerRouter(registry, network.nodes.map(node => node.entity), wires.flatMap(wire => [wire.source, wire.target]),
//         //   { minimumX: 0, minimumY: 0, maximumX: statistics.outline.width - 1, maximumY: statistics.outline.height - 1, escapeLength: 0 });
//         statistics.routingAttempts++;
//         // 2026-10-23：局部重布属于总布线次数，但不对应一次外层候选拒绝。
//         statistics.auxiliaryRoutingAttempts = (statistics.auxiliaryRoutingAttempts ?? 0) + 1;
//         const reused = new Set<number>(), byKey = new Map(wires.map((wire, index) => [key(wire), index]));
//         // 2026-10-20：按失败搜索实际接触的阻塞线路定向让路；每次只释放少量路径，保留其他合法缓存。
//         const released = new Set(guided ? blockingRoutes.slice(0, 1 + random.integer(Math.min(3, blockingRoutes.length))) : []);
//         const rip = !guided && random.integer(5) < 2;
//         // 先恢复全部仍合法的缓存，避免新失败边抢占已有路径后把部分指导退化成随机重布。
//         for (const route of routes) {
//           if (released.has(routeKey(route)) || rip && random.integer(100) < 8) continue;
//           const index = byKey.get(routeKey(route));
//           if (index === undefined) continue;
//           const wire = wires[index]!;
//           if (router.reuse(wire.source, wire.target, route.cells, wire.minimumCells)) reused.add(index);
//         }
//         const order = wires.flatMap((_, index) => reused.has(index) ? [] : [index]);
//         // applyBest 会重建端口对象，必须按连接索引保持失败边优先级。
//         order.sort((a, b) => Number(b === focusIndex) - Number(a === focusIndex));
//         const nextBlockers = new Map<string, readonly string[]>();
//         for (const index of order) {
//           const wire = wires[index]!;
//           try { await router.connect(wire.source, wire.target, checkBudget, wire.minimumCells); }
//           catch (error) {
//             if (!(error instanceof PlannerCandidateError)) throw error;
//             nextBlockers.set(key(wire), [...router.conflicts].sort((a, b) => b[1].size - a[1].size).map(([id]) => id));
//           }
//         }
//         const cost = score(router.routes);
//         // 2026-10-16：升温到 80 的对照未改善连通率，保留以已有线路为主的低温修复。
//         // AI-CORRECTION 2026-10-20：不持续高温；连通数停滞后交替恢复探索与低温精修，最终仍返回历史最佳完整快照。
//         // AI-CORRECTION 2026-10-20：交替升温本地六轮仍停在 21/25，未进入 Windows 对照；撤回实验，优先处理已确认的供电桩位阻塞。
//         // AI-REMOVED 2026-10-20:
//         // Reason: 未观察到局部改善，避免与已定位的供电调整叠加。
//         // Trigger: local-chain-v23 六轮各 8000 次仍为 21/25。
//         // Evidence: 本地探索不足以断言通用无效，只能作为本轮优先级判断。
//         // Replacement: 下方固定低温及 candidate.ts 的供电桩位替代搜索。
//         // Risk: 可能遗漏其他案例的收益；Human Review: Required。
//         // Original code:
//         // let step = 0, lastImprovement = 0;
//         // const temperature = Math.floor((step - lastImprovement) / 500) % 2 === 0 ? 8 : 80;
//         // lastImprovement = step;
//         const temperature = 8;
//         const candidateState = { network, wires, routes: router.routes, disconnectedWires, capacityDeficit };
//         accepted = comparePlannerPartialSeeds(candidateState, { network, wires: previous.wires, routes,
//           disconnectedWires: previous.disconnectedWires, capacityDeficit: previous.capacityDeficit }) < 0
//           || cost <= currentCost || random.next() / 4294967296 < Math.exp((currentCost - cost) / temperature);
//         if (accepted) {
//           routes = router.routes; blockers = nextBlockers; currentCost = cost; statistics.acceptedMoves++;
//           if (comparePlannerPartialSeeds(candidateState, { network, wires: explorationBest.wires, routes: explorationRoutes,
//             disconnectedWires: explorationBest.disconnectedWires, capacityDeficit: explorationBest.capacityDeficit }) < 0) {
//             explorationBest = snapshot(); explorationRoutes = routes;
//           }
//           // AI-REMOVED 2026-10-23:
//           // Reason: 仅轴下界的候选胜出不代表完整物理事实胜出，发布最优前必须确认。
//           // Trigger: 780真实新供电态1685已接受中1666代理/完整容量不同，33/35完整0被34/35完整1覆盖。
//           // Evidence: 780只读与779最终计数/search/snapshot逐项相同，完整旁观最优被丢弃。
//           // Replacement: 下方完整事实确认后的保留与回退；局部接受/能量仍使用旧代理。
//           // Risk: 增加潜在最优确认开销，原额度/PRNG/物理门槛保持；目前隔离原型。
//           // Human Review: Required
//           // Original code:
//           // if (comparePlannerPartialSeeds(candidateState, { network, wires: best.wires, routes: bestRoutes,
//           //   disconnectedWires: best.disconnectedWires, capacityDeficit: best.capacityDeficit }) < 0) {
//           const bestComparison = { network, wires: best.wires, routes: bestRoutes, ...bestComplete };
//           // 原代理是下界；只有仍可能胜出时才做完整检查，保持绝大多数局部提案的低成本。
//           // AI-CORRECTION 2026-10-23：有CPU方向断连时，旧代理容量可能与其重叠；仅门禁使用保守不重叠下界，能量仍原值。
//           // AI-REMOVED 2026-10-23:
//           // Reason: 完整最优门禁不能依赖可能重叠的代理合计，否则会在完整检查前误剪。
//           // Trigger: 完整事实合并语义统一。
//           // Evidence: max(D,C)是二者未知重叠时的保守下界；D=0时与原门禁相同。
//           // Replacement: 下方只给最优确认门禁的candidateLowerBound。
//           // Risk: D>0时可能增加完整检查；Human Review: Required
//           // Original code:
//           // if (comparePlannerPartialSeeds(candidateState, bestComparison) < 0) {
//           const candidateLowerBound = { ...candidateState, capacityDeficit: Math.max(0, capacityDeficit - disconnectedWires) };
//           if (comparePlannerPartialSeeds(candidateLowerBound, bestComparison) < 0) {
//             const candidateComplete = completeConstraints(router);
//             if (comparePlannerPartialSeeds({ ...candidateState, ...candidateComplete }, bestComparison) < 0) {
//               // AI-REMOVED 2026-10-23:
//               // Reason: 观察窗只因真实完整约束或连通进展续期，不再因代理假进展续期。
//               // Trigger: 780真实新供电态1685已接受中1666代理/完整容量不同，33/35完整0被34/35完整1覆盖。
//               // Evidence: 780只读与779最终计数/search/snapshot逐项相同，完整旁观最优被丢弃。
//               // Replacement: 下方完整事实确认后的保留与回退；局部接受/能量仍使用旧代理。
//               // Risk: 增加潜在最优确认开销，原额度/PRNG/物理门槛保持；目前隔离原型。
//               // Human Review: Required
//               // Original code:
//               // if (routes.length - disconnectedWires - capacityDeficit > bestRoutes.length - best.disconnectedWires - best.capacityDeficit
//               //   || disconnectedWires < best.disconnectedWires || capacityDeficit < best.capacityDeficit) {
//               if (routes.length - candidateComplete.disconnectedWires - candidateComplete.capacityDeficit > bestRoutes.length - bestComplete.disconnectedWires - bestComplete.capacityDeficit
//                 || candidateComplete.disconnectedWires < bestComplete.disconnectedWires || candidateComplete.capacityDeficit < bestComplete.capacityDeficit) {
//                 stop = Math.min(repairCeiling, statistics.evaluations + limit);
//               }
//               // AI-REMOVED 2026-10-23:
//               // Reason: 完整约束改善统计与所保留的真相一致。
//               // Trigger: 780真实新供电态1685已接受中1666代理/完整容量不同，33/35完整0被34/35完整1覆盖。
//               // Evidence: 780只读与779最终计数/search/snapshot逐项相同，完整旁观最优被丢弃。
//               // Replacement: 下方完整事实确认后的保留与回退；局部接受/能量仍使用旧代理。
//               // Risk: 增加潜在最优确认开销，原额度/PRNG/物理门槛保持；目前隔离原型。
//               // Human Review: Required
//               // Original code:
//               // if (disconnectedWires < best.disconnectedWires || capacityDeficit < best.capacityDeficit) {
//               if (candidateComplete.disconnectedWires < bestComplete.disconnectedWires || candidateComplete.capacityDeficit < bestComplete.capacityDeficit) {
//                 statistics.routeRepairConstraintImprovements = (statistics.routeRepairConstraintImprovements ?? 0) + 1;
//               }
//               if (routes.length > mostRouted) {
//                 statistics.routeRepairImprovements = (statistics.routeRepairImprovements ?? 0) + 1;
//                 mostRouted = routes.length;
//                 // AI-REMOVED 2026-10-21:
//                 // Reason: v29/v30 未达到 Windows 20M 首解门槛，撤回预算与入口实验，避免叠加未证实收益的机制。
//                 // Trigger: 优质锦草软饮 v29 为 31/32、v30 为 30/32，均无首解。
//                 // Evidence: .temp/playwright-test/eda-adaptive-20261021/v29/ 与 v30/。
//                 // Replacement: 原有 routeRepairImprovements 统计；本轮不执行续期。
//                 // Risk: 仅说明当前组合未通过，不能证明其他任务无收益。
//                 // Human Review: Required
//                 // Original code:
//                 // lastConnectionImprovement = statistics.evaluations;
//               }
//               // AI-REMOVED 2026-10-22:
//               // Reason: 旧最佳能量不再参与回退判定；Trigger: 可行性优先修正。
//               // Evidence: Windows probe533；Replacement: 下方状态快照；Risk: Low；Human Review: Required
//               // Original code:
//               // best = snapshot(); bestRoutes = routes; bestCost = cost;
//               // AI-REMOVED 2026-10-23:
//               // Reason: 历史最佳的姿态/路径与完整约束事实必须一起提交。
//               // Trigger: 780真实新供电态1685已接受中1666代理/完整容量不同，33/35完整0被34/35完整1覆盖。
//               // Evidence: 780只读与779最终计数/search/snapshot逐项相同，完整旁观最优被丢弃。
//               // Replacement: 下方完整事实确认后的保留与回退；局部接受/能量仍使用旧代理。
//               // Risk: 增加潜在最优确认开销，原额度/PRNG/物理门槛保持；目前隔离原型。
//               // Human Review: Required
//               // Original code:
//               // best = snapshot(); bestRoutes = routes;
//               best = snapshot(); bestRoutes = routes; bestComplete = candidateComplete;
//             }
//             // AI-REMOVED 2026-10-21: 最高连通数统计移至所有接受状态，避免统一评分选优后漏记实际连通峰值。
//             // Trigger: 最佳状态可用少一条路线换取静态可达；Evidence: probe52 的静态断路。
//             // Replacement: 下方接受分支末尾；Risk: Low；Human Review: Required。
//             // Original code: statistics.bestRoutedWireCount = Math.max(statistics.bestRoutedWireCount ?? 0, routes.length);
//           }
//           mostRouted = Math.max(mostRouted, routes.length);
//           statistics.bestRoutedWireCount = Math.max(statistics.bestRoutedWireCount ?? 0, routes.length);
//         }
//       }
//       if (!accepted) restore(previous);
//       if (step % 16 === 0) await yieldPlannerTask();
//     }
//   } finally {
//     // AI-CORRECTION 2026-10-26：异常和取消仍恢复最佳快照；完整性复核移到成功路径，避免收尾异常覆盖原始错误。
//     restore(best);
//   }
//   // 2026-10-23：发布与跨批保留继续使用完整成对下界，不能把局部代理的零当成完整必要检查。
//   const returnedRouter = new PlannerRouter(registry, network.nodes.map(node => node.entity), wires.flatMap(wire => [wire.source, wire.target]),
//     { minimumX: 0, minimumY: 0, maximumX: statistics.outline.width - 1, maximumY: statistics.outline.height - 1, escapeLength: 0 });
//   // AI-REMOVED 2026-10-23:
//   // Reason: 返回事实保留原CPU必要性并与已确认最佳一致，不能只替换末尾metadata。
//   // Trigger: 780真实新供电态1685已接受中1666代理/完整容量不同，33/35完整0被34/35完整1覆盖。
//   // Evidence: 780只读与779最终计数/search/snapshot逐项相同，完整旁观最优被丢弃。
//   // Replacement: 下方完整事实确认后的保留与回退；局部接受/能量仍使用旧代理。
//   // Risk: 增加潜在最优确认开销，原额度/PRNG/物理门槛保持；目前隔离原型。
//   // Human Review: Required
//   // Original code:
//   // const returnedConstraints = returnedRouter.staticConstraints(wires);
//   const returnedConstraints = completeConstraints(returnedRouter);
//   if (returnedConstraints.disconnectedWires !== bestComplete.disconnectedWires || returnedConstraints.capacityDeficit !== bestComplete.capacityDeficit)
//     throw new Error("局部修复返回与已保留的完整约束事实不一致。");
//   statistics.routeRepairDisconnectedWires = returnedConstraints.disconnectedWires;
//   statistics.routeRepairCapacityDeficit = returnedConstraints.capacityDeficit;
//   // 多目标分组属于初排提示；配对改变后按实际物流树重建，不能把旧分组写进续搜种子。
//   for (const [index, node] of network.nodes.entries()) {
//     if (!node.supplyTargets && !node.outputSources) continue;
//     const forward = Boolean(node.supplyTargets), found = new Set<string>(), visited = new Set([node.entity.id]), pending = [node.entity.id];
//     for (let cursor = 0; cursor < pending.length; cursor++) {
//       const id = pending[cursor]!;
//       for (const wire of wires) {
//         if ((forward ? wire.source.entityId : wire.target.entityId) !== id) continue;
//         const next = forward ? wire.target.entityId : wire.source.entityId;
//         if (visited.has(next)) continue;
//         visited.add(next);
//         if (nodes.get(next)!.purpose === "logistics") pending.push(next); else found.add(next);
//       }
//     }
//     const targets = [...found].map(entityId => ({ entityId }));
//     network.nodes[index] = { ...node, ...(forward ? { supplyTargets: targets } : { outputSources: targets }) };
//   }
//   return bestRoutes;
// }
//
