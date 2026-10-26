// AI-CORRECTION 2026-10-26：保留物理通行规则、GPU 容量和背压修复；不恢复新搜索分支。
// 单个工作组合作松弛带方向的路径；直接读取 CPU 共用的每格两个 u32。
@group(0) @binding(0) var<storage, read> parameters: array<u32>;
@group(0) @binding(1) var<storage, read> grid: array<u32>;
@group(0) @binding(2) var<storage, read_write> distances: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> result: array<u32>;
var<workgroup> configuration: array<u32, 8>;
var<workgroup> changed: atomic<u32>;
var<workgroup> keepSearching: u32;

// 2026-10-21：与 CPU 的 allowsPlannerReservationTransit 共用预留轴编码。
fn reservationAllows(word: u32, incoming: u32, outgoing: u32) -> bool {
  if ((word & 0x200000u) == 0u) { return true; }
  let axes = (word >> 24u) & 3u;
  return axes != 0u && incoming == outgoing && (axes & (1u << (incoming % 2u))) == 0u;
}

fn neighbor(cell: u32, direction: u32, width: u32, height: u32) -> u32 {
  switch direction {
    case 0u: { if (cell >= width) { return cell - width; } }
    case 1u: { if (cell % width + 1u < width) { return cell + 1u; } }
    case 2u: { if (cell / width + 1u < height) { return cell + width; } }
    default: { if (cell % width > 0u) { return cell - 1u; } }
  }
  return 0xffffffffu;
}

@compute @workgroup_size(128)
fn main(@builtin(local_invocation_index) lane: u32) {
  if (lane == 0u) { for (var i = 0u; i < 8u; i++) { configuration[i] = parameters[i]; } }
  let config = workgroupUniformLoad(&configuration);
  let width = config[0]; let height = config[1]; let start = config[2]; let goal = config[3];
  let startDirection = config[4]; let finalDirection = config[5]; let kind = config[6];
  let states = width * height * 4u;
  if (lane == 0u) { result[0] = 0u; result[1] = 0u; }
  for (var state = lane; state < states; state += 128u) { atomicStore(&distances[state], 0x3fffffffu); }
  storageBarrier();
  // 2026-10-21：起点必须和后继格一样满足阻挡与进入掩码，避免生成只能在缓存校验阶段拒绝的非法路径。
  let startWord = grid[start * 2u + kind];
  if (lane == 0u && (startWord & 0x100000u) == 0u && (startWord & (1u << (16u + startDirection))) != 0u) {
    atomicStore(&distances[start * 4u + startDirection], 0u);
  }
  storageBarrier();
  var rounds = 0u;
  loop {
    if (lane == 0u) { atomicStore(&changed, 0u); }
    workgroupBarrier();
    for (var state = lane; state < states; state += 128u) {
      let cost = atomicLoad(&distances[state]);
      if (cost == 0x3fffffffu) { continue; }
      let cell = state / 4u; let incoming = state % 4u; let word = grid[cell * 2u + kind];
      for (var outgoing = 0u; outgoing < 4u; outgoing++) {
        if ((word & (1u << (incoming * 4u + outgoing))) == 0u) { continue; }
        if (cell != start && cell != goal && !reservationAllows(word, incoming, outgoing)) { continue; }
        let next = neighbor(cell, outgoing, width, height);
        if (next == 0xffffffffu) { continue; }
        let nextWord = grid[next * 2u + kind];
        if ((nextWord & 0x100000u) != 0u || (next != start && next != goal && !reservationAllows(nextWord, outgoing, outgoing))
          || (nextWord & (1u << (16u + outgoing))) == 0u) { continue; }
        var turn = 0u;
        if (incoming != outgoing) { turn = select(10u, 30u, cell == start); }
        let nextCost = cost + select(10u, 12u, (nextWord & 0x400000u) != 0u) + turn;
        if (nextCost < atomicMin(&distances[next * 4u + outgoing], nextCost)) { atomicStore(&changed, 1u); }
      }
    }
    storageBarrier(); workgroupBarrier(); rounds++;
    if (lane == 0u) { keepSearching = atomicLoad(&changed); }
    if (workgroupUniformLoad(&keepSearching) == 0u) { break; }
    // 有界执行防止长路径阻塞 GPU；超过范围由 CPU 继续完整搜索。
    if (rounds >= 512u) { return; }
  }
  if (lane != 0u) { return; }
  var cursor = 0xffffffffu; var best = 0x3fffffffu;
  for (var direction = 0u; direction < 4u; direction++) {
    let state = goal * 4u + direction; let cost = atomicLoad(&distances[state]);
    if ((grid[goal * 2u + kind] & (1u << (direction * 4u + finalDirection))) != 0u && cost < best) {
      cursor = state; best = cost;
    }
  }
  if (cursor == 0xffffffffu) { return; }
  var length = 0u;
  loop {
    let cell = cursor / 4u; let direction = cursor % 4u;
    if (length >= 512u) { return; }
    result[2u + length] = cell; length++;
    if (cursor == start * 4u + startDirection) { break; }
    let previous = neighbor(cell, (direction + 2u) % 4u, width, height);
    if (previous == 0xffffffffu) { return; }
    var found = false;
    for (var incoming = 0u; incoming < 4u; incoming++) {
      if ((grid[previous * 2u + kind] & (1u << (incoming * 4u + direction))) == 0u) { continue; }
      if (previous != start && previous != goal && !reservationAllows(grid[previous * 2u + kind], incoming, direction)) { continue; }
      var turn = 0u;
      if (incoming != direction) { turn = select(10u, 30u, previous == start); }
      let cost = atomicLoad(&distances[previous * 4u + incoming])
        + select(10u, 12u, (grid[cell * 2u + kind] & 0x400000u) != 0u) + turn;
      if (cost == atomicLoad(&distances[cursor])) { cursor = previous * 4u + incoming; found = true; break; }
    }
    if (!found) { return; }
  }
  result[0] = 1u; result[1] = length;
}

// AI-REMOVED 2026-10-26:
// Reason: 用户要求恢复 beta1/2 搜索内核，撤回其后搜索实现；保留业务正确性修复与公开任务接口。
// Trigger: 多版本对照后用户明确要求回退算法并使用 2S 渐增至 3S 初始面积。
// Evidence: .temp/eda/all-items/comparisons/default-area-20261026T015057315Z.json；回退前 SHA256 fd160dae4ad12d4741748872b8d55fd688bc24bb53f42e34195df8348cbf76fe。
// Replacement: src/blueprint-planner/routing-wave.wgsl 上方 beta1/2 活动实现
// Risk: 搜索策略、检查点及后续局部修复能力变化；原始未提交内容完整保留。
// Human Review: Required
// Original code (src/blueprint-planner/routing-wave.wgsl):
// // 单个工作组合作松弛带方向的路径；直接读取 CPU 共用的每格两个 u32。
// @group(0) @binding(0) var<storage, read> parameters: array<u32>;
// @group(0) @binding(1) var<storage, read> grid: array<u32>;
// @group(0) @binding(2) var<storage, read_write> distances: array<atomic<u32>>;
// @group(0) @binding(3) var<storage, read_write> result: array<u32>;
// var<workgroup> configuration: array<u32, 8>;
// var<workgroup> changed: atomic<u32>;
// var<workgroup> keepSearching: u32;
//
// // 2026-10-21：与 CPU 的 allowsPlannerReservationTransit 共用预留轴编码。
// fn reservationAllows(word: u32, incoming: u32, outgoing: u32) -> bool {
//   if ((word & 0x200000u) == 0u) { return true; }
//   let axes = (word >> 24u) & 3u;
//   return axes != 0u && incoming == outgoing && (axes & (1u << (incoming % 2u))) == 0u;
// }
//
// fn neighbor(cell: u32, direction: u32, width: u32, height: u32) -> u32 {
//   switch direction {
//     case 0u: { if (cell >= width) { return cell - width; } }
//     case 1u: { if (cell % width + 1u < width) { return cell + 1u; } }
//     case 2u: { if (cell / width + 1u < height) { return cell + width; } }
//     default: { if (cell % width > 0u) { return cell - 1u; } }
//   }
//   return 0xffffffffu;
// }
//
// @compute @workgroup_size(128)
// fn main(@builtin(local_invocation_index) lane: u32) {
//   if (lane == 0u) { for (var i = 0u; i < 8u; i++) { configuration[i] = parameters[i]; } }
//   let config = workgroupUniformLoad(&configuration);
//   let width = config[0]; let height = config[1]; let start = config[2]; let goal = config[3];
//   let startDirection = config[4]; let finalDirection = config[5]; let kind = config[6];
//   let states = width * height * 4u;
//   if (lane == 0u) { result[0] = 0u; result[1] = 0u; }
//   for (var state = lane; state < states; state += 128u) { atomicStore(&distances[state], 0x3fffffffu); }
//   storageBarrier();
//   // 2026-10-21：起点必须和后继格一样满足阻挡与进入掩码，避免生成只能在缓存校验阶段拒绝的非法路径。
//   let startWord = grid[start * 2u + kind];
//   if (lane == 0u && (startWord & 0x100000u) == 0u && (startWord & (1u << (16u + startDirection))) != 0u) {
//     atomicStore(&distances[start * 4u + startDirection], 0u);
//   }
//   storageBarrier();
//   var rounds = 0u;
//   loop {
//     if (lane == 0u) { atomicStore(&changed, 0u); }
//     workgroupBarrier();
//     for (var state = lane; state < states; state += 128u) {
//       let cost = atomicLoad(&distances[state]);
//       if (cost == 0x3fffffffu) { continue; }
//       let cell = state / 4u; let incoming = state % 4u; let word = grid[cell * 2u + kind];
//       for (var outgoing = 0u; outgoing < 4u; outgoing++) {
//         if ((word & (1u << (incoming * 4u + outgoing))) == 0u) { continue; }
//         if (cell != start && cell != goal && !reservationAllows(word, incoming, outgoing)) { continue; }
//         let next = neighbor(cell, outgoing, width, height);
//         if (next == 0xffffffffu) { continue; }
//         let nextWord = grid[next * 2u + kind];
//         if ((nextWord & 0x100000u) != 0u || (next != start && next != goal && !reservationAllows(nextWord, outgoing, outgoing))
//           || (nextWord & (1u << (16u + outgoing))) == 0u) { continue; }
//         var turn = 0u;
//         if (incoming != outgoing) { turn = select(10u, 30u, cell == start); }
//         let nextCost = cost + select(10u, 12u, (nextWord & 0x400000u) != 0u) + turn;
//         if (nextCost < atomicMin(&distances[next * 4u + outgoing], nextCost)) { atomicStore(&changed, 1u); }
//       }
//     }
//     storageBarrier(); workgroupBarrier(); rounds++;
//     if (lane == 0u) { keepSearching = atomicLoad(&changed); }
//     if (workgroupUniformLoad(&keepSearching) == 0u) { break; }
//     // 有界执行防止长路径阻塞 GPU；超过范围由 CPU 继续完整搜索。
//     if (rounds >= 512u) { return; }
//   }
//   if (lane != 0u) { return; }
//   var cursor = 0xffffffffu; var best = 0x3fffffffu;
//   for (var direction = 0u; direction < 4u; direction++) {
//     let state = goal * 4u + direction; let cost = atomicLoad(&distances[state]);
//     if ((grid[goal * 2u + kind] & (1u << (direction * 4u + finalDirection))) != 0u && cost < best) {
//       cursor = state; best = cost;
//     }
//   }
//   if (cursor == 0xffffffffu) { return; }
//   var length = 0u;
//   loop {
//     let cell = cursor / 4u; let direction = cursor % 4u;
//     if (length >= 512u) { return; }
//     result[2u + length] = cell; length++;
//     if (cursor == start * 4u + startDirection) { break; }
//     let previous = neighbor(cell, (direction + 2u) % 4u, width, height);
//     if (previous == 0xffffffffu) { return; }
//     var found = false;
//     for (var incoming = 0u; incoming < 4u; incoming++) {
//       if ((grid[previous * 2u + kind] & (1u << (incoming * 4u + direction))) == 0u) { continue; }
//       if (previous != start && previous != goal && !reservationAllows(grid[previous * 2u + kind], incoming, direction)) { continue; }
//       var turn = 0u;
//       if (incoming != direction) { turn = select(10u, 30u, previous == start); }
//       let cost = atomicLoad(&distances[previous * 4u + incoming])
//         + select(10u, 12u, (grid[cell * 2u + kind] & 0x400000u) != 0u) + turn;
//       if (cost == atomicLoad(&distances[cursor])) { cursor = previous * 4u + incoming; found = true; break; }
//     }
//     if (!found) { return; }
//   }
//   result[0] = 1u; result[1] = length;
// }
//
