const PAGE_SIZE = 1024;

/** A* 的数值工作区；每次寻路重置逻辑长度，复用队列与按需分配的 best 页。 */
export class PlannerRoutingSearch {
  cells = new Uint32Array(256);
  directions = new Uint8Array(256);
  steps = new Uint32Array(256);
  parents = new Int32Array(256);
  costs = new Float64Array(256);
  private estimates = new Float64Array(256);
  private heap = new Uint32Array(256);
  private count = 0;
  private heapSize = 0;
  private levels = 1;
  private readonly pages = new Map<number, Float64Array>();
  private readonly pagePool: Float64Array[] = [];
  private readonly boundedScores?: Float64Array;

  /** 零长度状态的有限格网可直接索引；一般Router继续使用原按需分页工作区。 */
  constructor(boundedCells?: number) {
    if (boundedCells !== undefined) {
      if (!Number.isSafeInteger(boundedCells) || boundedCells < 1 || !Number.isSafeInteger(boundedCells * 4)) {
        throw new Error("有界寻路工作区的格数无效。");
      }
      this.boundedScores = new Float64Array(boundedCells * 4).fill(Infinity);
    }
  }

  get size(): number { return this.heapSize; }

  reset(minimumCells: number): void {
    if (this.boundedScores && minimumCells !== 0) throw new Error("有界寻路工作区仅支持零最短长度。");
    this.count = 0; this.heapSize = 0; this.levels = minimumCells + 1; this.pages.clear();
    this.boundedScores?.fill(Infinity);
  }

  private scorePage(cell: number, direction: number, steps: number): { page: Float64Array; offset: number } {
    const state = (cell * 4 + direction) * this.levels + Math.min(steps, this.levels - 1);
    const index = Math.floor(state / PAGE_SIZE);
    let page = this.pages.get(index);
    if (!page) {
      page = this.pagePool[this.pages.size] ?? new Float64Array(PAGE_SIZE);
      this.pagePool[this.pages.size] = page; page.fill(Infinity); this.pages.set(index, page);
    }
    return { page, offset: state % PAGE_SIZE };
  }

  stale(entry: number): boolean {
    if (this.boundedScores) return this.boundedScores[this.cells[entry]! * 4 + this.directions[entry]!]! < this.costs[entry]!;
    const { page, offset } = this.scorePage(this.cells[entry]!, this.directions[entry]!, this.steps[entry]!);
    return page[offset]! < this.costs[entry]!;
  }

  push(cell: number, direction: number, steps: number, cost: number, estimate: number, parent: number): void {
    if (this.boundedScores) {
      const state = cell * 4 + direction, previous = this.boundedScores[state];
      if (previous === undefined) throw new Error("有界寻路状态超出工作区。");
      if (previous <= cost) return;
      this.boundedScores[state] = cost;
    } else {
      const { page, offset } = this.scorePage(cell, direction, steps);
      if (page[offset]! <= cost) return;
      page[offset] = cost;
    }
    const id = this.count++;
    if (id === this.cells.length) {
      const capacity = this.cells.length * 2;
      const cells = new Uint32Array(capacity); cells.set(this.cells); this.cells = cells;
      const directions = new Uint8Array(capacity); directions.set(this.directions); this.directions = directions;
      const stepsArray = new Uint32Array(capacity); stepsArray.set(this.steps); this.steps = stepsArray;
      const parents = new Int32Array(capacity); parents.set(this.parents); this.parents = parents;
      const costs = new Float64Array(capacity); costs.set(this.costs); this.costs = costs;
      const estimates = new Float64Array(capacity); estimates.set(this.estimates); this.estimates = estimates;
      const heap = new Uint32Array(capacity); heap.set(this.heap); this.heap = heap;
    }
    this.cells[id] = cell; this.directions[id] = direction; this.steps[id] = steps;
    this.costs[id] = cost; this.estimates[id] = estimate; this.parents[id] = parent;
    let index = this.heapSize++;
    while (index > 0) {
      const above = Math.floor((index - 1) / 2), entry = this.heap[above]!;
      if (this.estimates[entry]! <= estimate) break;
      this.heap[index] = entry; index = above;
    }
    this.heap[index] = id;
  }

  /** 同估价保留原队列的堆遍历规则；不以新 ID 额外改变并列顺序。 */
  pop(): number {
    const first = this.heap[0]!, tail = this.heap[--this.heapSize]!;
    if (this.heapSize === 0) return first;
    let index = 0;
    while (index * 2 + 1 < this.heapSize) {
      let child = index * 2 + 1;
      if (child + 1 < this.heapSize && this.estimates[this.heap[child + 1]!]! < this.estimates[this.heap[child]!]!) child++;
      if (this.estimates[tail]! <= this.estimates[this.heap[child]!]!) break;
      this.heap[index] = this.heap[child]!; index = child;
    }
    this.heap[index] = tail;
    return first;
  }
}
