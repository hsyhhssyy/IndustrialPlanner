import type { GridRotation } from "@/domain/shared/grid";
import { PLANNER_LAYOUT_GEOMETRY_STRIDE as G, PLANNER_LAYOUT_COOLING_STEPS, plannerBusConflictCount,
  type PlannerLayoutBatch, type PlannerLayoutBatchResult } from "./layout-backend";

/** WGSL 数值内核的 CPU 执行器：共用快照、动作、退火日程和链状态；完整合法性由调用者复核。 */
export class PlannerCpuLayout {
  async search(input: PlannerLayoutBatch, checkBudget: () => void = () => {}): Promise<PlannerLayoutBatchResult> {
    const n = input.parameters[0]!, steps = input.parameters[4]!, stride = n * 3 + 2;
    const states = new Int32Array(input.chains * stride), results: Array<{ cost: number; pose: Int32Array }> = [];
    for (let chain = 0; chain < input.chains; chain++) {
      const kernel = new PlannerLayoutKernel(input, chain);
      let best = kernel.poses.slice(), bestCost = kernel.score(), current = bestCost;
      for (let step = 0; step < steps; step++) {
        checkBudget();
        const old = kernel.poses.slice();
        kernel.propose();
        const cost = kernel.score();
        if (cost < bestCost) { bestCost = cost; best = kernel.poses.slice(); }
        const temperature = Math.max(10, input.parameters[6]! * (1 - kernel.age % PLANNER_LAYOUT_COOLING_STEPS / PLANNER_LAYOUT_COOLING_STEPS));
        if (cost <= current || kernel.random() / 4294967296 < Math.exp((current - cost) / temperature)) current = cost;
        else kernel.poses.set(old);
        kernel.age++;
        if (step % 64 === 63) await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      states[chain * stride] = kernel.randomState; states[chain * stride + 1] = kernel.age;
      states.set(kernel.poses, chain * stride + 2);
      results.push({ cost: bestCost, pose: best });
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    results.sort((a, b) => a.cost - b.cost);
    const seen = new Set<string>();
    const selected = results.filter(result => { const key = result.pose.join(","); if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 16);
    return { evaluations: input.chains * steps, kernelMs: 0, states, scores: selected.map(result => result.cost),
      poses: selected.map(({ pose }) => Array.from({ length: n }, (_, i) => ({ x: pose[i * 3]!, y: pose[i * 3 + 1]!, rotation: pose[i * 3 + 2]! * 90 as GridRotation }))) };
  }
}

/** 导出数值评分入口供跨后端一致性验证；不调用 Registry 或另一套游戏规则。 */
export class PlannerLayoutKernel {
  readonly poses: Int32Array;
  randomState: number;
  age: number;
  private readonly n: number;
  private readonly width: number;
  private readonly height: number;
  constructor(private readonly input: PlannerLayoutBatch, chain = 0) {
    this.n = input.parameters[0]!; this.width = input.parameters[2]!; this.height = input.parameters[3]!;
    const stride = this.n * 3 + 2, offset = chain * stride;
    const restored = input.states && input.states.length >= offset + stride;
    this.poses = restored ? input.states!.slice(offset + 2, offset + stride) : input.poses.slice();
    this.randomState = restored ? input.states![offset]! >>> 0 : ((input.parameters[5]! + Math.imul(chain, 747796405) + 2891336453) | 1) >>> 0;
    this.age = restored ? input.states![offset + 1]! : 0;
  }
  random(): number {
    let x = this.randomState; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return this.randomState = x >>> 0;
  }
  private dim(n: number, field: number): number { return this.input.geometry[(n * 4 + this.poses[n * 3 + 2]!) * G + field]!; }
  private point(n: number): [number, number] { return [this.poses[n * 3]!, this.poses[n * 3 + 1]!]; }
  private inside(x: number, y: number, n: number): boolean {
    const [a, b] = this.point(n); return x >= a && y >= b && x < a + this.dim(n, 0) && y < b + this.dim(n, 1);
  }
  private endpoint(e: number, destination: boolean, outside: boolean): [number, number] {
    const offset = e * 40, node = this.input.edges[offset + Number(destination)]!;
    const k = offset + 8 + (destination ? 16 : 0) + this.poses[node * 3 + 2]! * 4 + (outside ? 0 : 2);
    return [this.poses[node * 3]! + this.input.edges[k]!, this.poses[node * 3 + 1]! + this.input.edges[k + 1]!];
  }
  private snap(n: number): void {
    if (this.dim(n, 40)) return;
    const side = this.dim(n, 2), k = n * 3;
    if (side < 0) return;
    this.poses[k] = Math.max(0, Math.min(this.width - this.dim(n, 0), this.poses[k]!));
    this.poses[k + 1] = Math.max(0, Math.min(this.height - this.dim(n, 1), this.poses[k + 1]!));
    if (side === 0) this.poses[k + 1] = 0;
    if (side === 1) this.poses[k] = this.width - this.dim(n, 0);
    if (side === 2) this.poses[k + 1] = this.height - this.dim(n, 1);
    if (side === 3) this.poses[k] = 0;
  }
  propose(): void {
    const old = this.poses.slice();
    const movable = Array.from({ length: this.n }, (_, i) => i).filter(i => !this.dim(i, 40));
    if (!movable.length) return;
    const focused = movable.filter(i => this.dim(i, 7));
    const pool = focused.length && this.random() % 100 < 65 ? focused : movable;
    const chosen = pool[this.random() % pool.length]!, k = chosen * 3;
    if (this.dim(chosen, 40)) return;
    let x = old[k]!, y = old[k + 1]!, turn = old[k + 2]!;
    if (this.random() % 5 === 0) turn = this.random() % 4;
    this.poses[k + 2] = turn;
    const w = this.dim(chosen, 0), h = this.dim(chosen, 1);
    if (this.random() % 4 === 0) { x = this.random() % Math.max(1, this.width - w + 1); y = this.random() % Math.max(1, this.height - h + 1); }
    else { x = Math.max(0, Math.min(this.width - w, x + this.random() % 7 - 3)); y = Math.max(0, Math.min(this.height - h, y + this.random() % 7 - 3)); }
    if (this.random() % 3 === 0) for (let offset = 0; offset < this.input.parameters[1]!; offset++) {
      const e = ((this.random() + offset) >>> 0) % this.input.parameters[1]!, start = this.input.edges[e * 40]!, end = this.input.edges[e * 40 + 1]!;
      if (start !== chosen && end !== chosen) continue;
      const other = this.endpoint(e, start === chosen, true), cell = this.endpoint(e, start === chosen, false);
      const dx = other[0] - cell[0], dy = other[1] - cell[1], o = e * 40 + 8 + (end === chosen ? 16 : 0);
      let lx = 0, ly = 0;
      for (let r = 0; r < 4; r++) { const at = o + r * 4;
        if (this.input.edges[at]! - this.input.edges[at + 2]! === -dx && this.input.edges[at + 1]! - this.input.edges[at + 3]! === -dy) {
          turn = r; lx = this.input.edges[at + 2]!; ly = this.input.edges[at + 3]!; break;
        }
      }
      this.poses[k + 2] = turn;
      const gap = Math.max(this.input.edges[e * 40 + 3]!, this.input.edges[e * 40 + 5] ? 0 : 1) + this.random() % 3;
      x = other[0] + dx * gap - lx; y = other[1] + dy * gap - ly; break;
    }
    if (this.random() % 8 === 0) {
      const partner = this.random() % this.n;
      if (!this.dim(partner, 40)) { const [a, b] = this.point(partner); this.poses[partner * 3] = old[k]!; this.poses[partner * 3 + 1] = old[k + 1]!; x = a; y = b; }
    }
    this.poses[k] = x; this.poses[k + 1] = y; this.poses[k + 2] = turn;
    for (let child = 0; child < this.n; child++) if (this.dim(child, 6) === chosen + 1 && !this.dim(child, 40)) {
      const c = child * 3, dx = old[c]! - old[k]!, dy = old[c + 1]! - old[k + 1]!, r = (turn - old[k + 2]! + 4) % 4;
      const pw = this.input.geometry[(chosen * 4 + old[k + 2]!) * G]!, ph = this.input.geometry[(chosen * 4 + old[k + 2]!) * G + 1]!;
      const cw = this.input.geometry[(child * 4 + old[c + 2]!) * G]!, ch = this.input.geometry[(child * 4 + old[c + 2]!) * G + 1]!;
      this.poses[c] = x + (r === 1 ? ph - dy - ch : r === 2 ? pw - dx - cw : r === 3 ? dy : dx);
      this.poses[c + 1] = y + (r === 1 ? dx : r === 2 ? ph - dy - ch : r === 3 ? pw - dx - cw : dy);
      this.poses[c + 2] = (old[c + 2]! + r) % 4;
    }
    for (let i = 0; i < this.n; i++) this.snap(i);
  }
  score(): number {
    let cost = 0;
    const warehouse = [0, 0, 0, 0], belts = [0, 0, 0, 0];
    const fixtures: Array<{ x: number; y: number; mask: number }> = [];
    for (let i = 0; i < this.n; i++) {
      const [x, y] = this.point(i), w = this.dim(i, 0), h = this.dim(i, 1);
      cost += (Math.max(0, -x) + Math.max(0, -y) + Math.max(0, x + w - this.width) + Math.max(0, y + h - this.height)) * 10000;
      for (let k = 0; k < this.dim(i, 5); k++) {
        const qx = x + this.dim(i, 8 + k * 2), qy = y + this.dim(i, 9 + k * 2), mask = this.dim(i, 56 + k);
        for (const other of fixtures) if (other.x === qx && other.y === qy) cost += 10000;
        fixtures.push({ x: qx, y: qy, mask });
        for (let j = 0; j < this.n; j++) if (this.inside(qx, qy, j) && (mask === 3 || (this.dim(j, 4) & 1))) cost += 10000;
      }
      for (let j = 0; j < i; j++) {
        const [a, b] = this.point(j);
        if (!this.input.overlaps[i * this.n + j]) cost += Math.max(0, Math.min(x + w, a + this.dim(j, 0)) - Math.max(x, a))
          * Math.max(0, Math.min(y + h, b + this.dim(j, 1)) - Math.max(y, b)) * 10000;
        const range = this.dim(i, 41);
        if (range > 0 && this.dim(i, 42) === this.dim(j, 42) && x - range < a + this.dim(j, 0) && a < x + w + range
          && y - range < b + this.dim(j, 1) && b < y + h + range) cost += 100000;
      }
      for (const gas of [false, true]) {
        const required = gas ? this.dim(i, 49) : this.dim(i, 43);
        if (!required) continue;
        let distance = Infinity;
        for (let j = 0; j < this.n; j++) {
          const offset = gas ? 50 : 44;
          if (gas ? this.dim(j, 48) !== required : this.dim(j, 46) === 0) continue;
          const [a, b] = this.point(j), rx = a + this.dim(j, offset), ry = b + this.dim(j, offset + 1), rw = this.dim(j, offset + 2), rh = this.dim(j, offset + 3);
          const d = gas ? Math.max(0, rx - x) + Math.max(0, ry - y) + Math.max(0, x + w - rx - rw) + Math.max(0, y + h - ry - rh)
            : Math.max(0, rx - x - w + 1, x - rx - rw + 1) + Math.max(0, ry - y - h + 1, y - ry - rh + 1);
          distance = Math.min(distance, d);
        }
        cost += (Number.isFinite(distance) ? distance : 100) * 10000;
      }
      const side = this.dim(i, 2), kind = this.dim(i, 3);
      if (side >= 0) { if (kind === 1) warehouse[side]!++; if (kind === 2) belts[side]!++; }
    }
    // AI-REMOVED 2026-10-10: 布尔罚分没有逐口修复梯度。
    // Reason: 恢复逐口迁移的评分方向。
    // Trigger: 存取面停滞；Evidence: boundary-stagnation-probe.json；Replacement: plannerBusConflictCount。
    // Risk: 搜索轨迹变化；Human Review: Required。
    // Original code:
    // const masks = [0, 1, 2, 4, 8, 3, 6, 12, 9, 7, 14, 13, 11];
    // if (!masks.slice(0, this.input.parameters[7] === 1 ? 5 : this.input.parameters[7] === 2 ? 9 : 13).some(mask => (mask & warehouse) === warehouse && !(mask & belts))) cost += 10000;
    cost += plannerBusConflictCount(this.input.parameters[7]!, warehouse, belts) * 10000;
    const endpoints = Array.from({ length: this.input.parameters[1]! }, (_, e) => {
      const a = this.endpoint(e, false, true), b = this.endpoint(e, true, true), ac = this.endpoint(e, false, false), bc = this.endpoint(e, true, false), o = e * 40;
      return { a, b, kind: this.input.edges[o + 2]!, direct: this.input.edges[o + 3] === 0 && a[0] === bc[0] && a[1] === bc[1] && b[0] === ac[0] && b[1] === ac[1] && this.input.edges[o + 5] !== 0 };
    });
    for (const [e, edge] of endpoints.entries()) {
      const { a, b, kind, direct } = edge, o = e * 40, distance = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
      cost += Math.max(distance, this.input.edges[o + 3]! - 1) * this.input.edges[o + 4]! * 10 + Math.max(0, this.input.edges[o + 3]! - distance - 1) * 3000;
      if (direct) continue;
      for (const q of [a, b]) {
        cost += (Math.max(0, -q[0]) + Math.max(0, -q[1]) + Math.max(0, q[0] + 1 - this.width) + Math.max(0, q[1] + 1 - this.height)) * 10000;
        for (let i = 0; i < this.n; i++) if ((this.dim(i, 4) & kind) && this.inside(q[0], q[1], i)) cost += 10000;
        for (let f = 0; f < e; f++) { const other = endpoints[f]!; if (other.kind === kind && [other.a, other.b].some(p => p[0] === q[0] && p[1] === q[1])) cost += 10000; }
      }
    }
    if (this.input.parameters[8]) for (const kind of [1, 2]) {
      const grid = new Int32Array(this.width * this.height), queue = new Int32Array(grid.length);
      const at = (x: number, y: number) => x < 0 || x >= this.width || y < 0 || y >= this.height ? -1 : y * this.width + x;
      for (let i = 0; i < this.n; i++) if (this.dim(i, 4) & kind) {
        const [x, y] = this.point(i);
        for (let cy = Math.max(0, y); cy < Math.min(this.height, y + this.dim(i, 1)); cy++) for (let cx = Math.max(0, x); cx < Math.min(this.width, x + this.dim(i, 0)); cx++) grid[at(cx, cy)] = -1;
      }
      for (const f of fixtures) if ((f.mask & kind) && at(f.x, f.y) >= 0) grid[at(f.x, f.y)] = -1;
      for (const edge of endpoints.filter(edge => edge.kind === kind)) for (const p of [edge.a, edge.b]) if (at(...p) >= 0) grid[at(...p)] = -1;
      let component = 0;
      for (let cell = 0; cell < grid.length; cell++) if (grid[cell] === 0) {
        grid[cell] = ++component; queue[0] = cell;
        for (let head = 0, tail = 1; head < tail; head++) {
          const p = queue[head]!, x = p % this.width, y = Math.floor(p / this.width);
          for (const neighbor of [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)]) if (neighbor >= 0 && grid[neighbor] === 0) { grid[neighbor] = component; queue[tail++] = neighbor; }
        }
      }
      const accessible = ([x, y]: readonly number[]) => [at(x! - 1, y!), at(x! + 1, y!), at(x!, y! - 1), at(x!, y! + 1)].filter(i => i >= 0).map(i => grid[i]!).filter(v => v > 0);
      for (const edge of endpoints.filter(edge => edge.kind === kind && !edge.direct)) if (Math.abs(edge.a[0] - edge.b[0]) + Math.abs(edge.a[1] - edge.b[1]) > 1
        && !accessible(edge.a).some(value => accessible(edge.b).includes(value))) cost += 10000;
    }
    return cost;
  }
}
