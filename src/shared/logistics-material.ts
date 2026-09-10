/** 物流素材协议；这里的 shape 和 spriteId 仅描述绘图资源，不承担 Registry 分类。 */
export type LogisticsMaterialShape = "straight" | "left" | "right";
export type LogisticsMaterialKind = "belt" | "pipe";

export interface LogisticsMaterialSpec {
  readonly kind: LogisticsMaterialKind;
  readonly shape: LogisticsMaterialShape;
  /** 源素材上进方向转换为现有 spriteId 的 0° 朝向。 */
  readonly rotation: number;
}

export interface LogisticsStaticFrame {
  readonly page: string;
  readonly rect: readonly [number, number, number, number];
}

export interface LogisticsStaticManifest {
  readonly schemaVersion: 1;
  readonly materialContractVersion: 2;
  readonly pixelsPerCell: 128;
  readonly pages: Readonly<Record<string, { readonly file: string; readonly width: number; readonly height: number }>>;
  readonly frames: Readonly<Record<string, LogisticsStaticFrame>>;
}

export interface LogisticsDynamicResource {
  readonly file: string;
  readonly width: number;
  readonly height: number;
  readonly data: boolean;
  readonly filter: "linear" | "nearest";
  readonly wrap: "repeat" | "clamp";
}

export interface LogisticsDynamicManifest {
  readonly schemaVersion: 1;
  readonly materialContractVersion: 2;
  readonly resources: Readonly<Record<string, LogisticsDynamicResource>>;
  readonly vertex: string;
  readonly fragment: string;
  readonly belt: Readonly<Record<string, number>>;
  readonly pipe: Readonly<Record<string, number>>;
}

export interface LogisticsMaterialPlacement extends LogisticsMaterialSpec {
  readonly start: number;
  readonly support: boolean;
  readonly marker: boolean;
}

export interface LogisticsMaterialRoutePlacement extends LogisticsMaterialPlacement {
  readonly routeId: string;
}

export interface LogisticsPipeFlowState {
  readonly seconds: number;
  readonly flowing: boolean;
}

export interface LogisticsMaterialEntityState extends LogisticsMaterialPlacement {
  readonly color: string;
  /** 虚影只取静态图集；实际管道共享所属运输组的时钟。 */
  readonly preview?: true;
  readonly pipeFlow?: LogisticsPipeFlowState;
}

export interface LogisticsMaterialFrameState {
  readonly entities: ReadonlyMap<string, LogisticsMaterialEntityState>;
  readonly beltSeconds: number;
  // AI-REMOVED 2026-09-10:
  // Reason: 全场管道时钟会让空运输组跟随其他组流动。
  // Trigger: 用户要求各运输锁定组独立停动与恢复。
  // Evidence: 原 SceneState.hasFluid 是全场聚合值。
  // Replacement: LogisticsMaterialEntityState.pipeFlow。
  // Risk: Low; Human Review: Required
  // Original code:
  // readonly pipeSeconds: number;
  readonly animationEnabled: boolean;
}

export const LOGISTICS_STATIC_ARROW_PHASE = -0.0029871862169272845;
export const LOGISTICS_MATERIAL_SHAPES: readonly LogisticsMaterialShape[] = ["straight", "left", "right"];

export function resolveLogisticsMaterialSpec(spriteId: string): LogisticsMaterialSpec | null {
  const match = /^(belt|pipe)_(straight|turn_cw|turn_ccw)_1x1$/.exec(spriteId);
  if (!match) return null;
  return {
    kind: match[1] as LogisticsMaterialKind,
    shape: match[2] === "straight" ? "straight" : match[2] === "turn_cw" ? "left" : "right",
    rotation: match[2] === "straight" ? 270 : match[2] === "turn_cw" ? 90 : 0,
  };
}

export function resolveLogisticsFluidColor(tags: readonly string[]): string {
  const tag = tags.find((value) => /^(gas_color|fluid_color|liquid_color):/.test(value));
  const color = tag?.slice(tag.indexOf(":") + 1).trim().replace(/^#/, "").toLowerCase();
  return color !== undefined && /^[\da-f]{6}$/.test(color) ? color : "ffffff";
}

export function logisticsStaticFrameKey(state: LogisticsMaterialEntityState): string {
  if (state.kind === "belt") return `belt/${state.shape}`;
  return `pipe/${state.color}/${state.shape}/${Number(state.support)}${Number(state.marker)}`;
}

export interface LogisticsMaterialPathEntry extends LogisticsMaterialSpec {
  readonly id: string;
  readonly input: string;
  readonly output: string;
  readonly inputConnectedToDevice?: boolean;
  readonly outputConnectedToDevice?: boolean;
}

/** 每节累计一个材质单位，独立于货物沿圆弧移动的几何距离。闭环在稳定 ID 处切开。 */
export function resolveLogisticsMaterialPlacements(
  entries: readonly LogisticsMaterialPathEntry[],
): ReadonlyMap<string, LogisticsMaterialRoutePlacement> {
  const ordered = [...entries].sort((a, b) => a.id.localeCompare(b.id));
  const inputs = new Map<string, LogisticsMaterialPathEntry[]>();
  const outputs = new Map<string, LogisticsMaterialPathEntry[]>();
  for (const entry of ordered) {
    const key = `${entry.kind}:${entry.input}`;
    const values = inputs.get(key) ?? [];
    values.push(entry);
    inputs.set(key, values);
    const outputKey = `${entry.kind}:${entry.output}`;
    const previous = outputs.get(outputKey) ?? [];
    previous.push(entry);
    outputs.set(outputKey, previous);
  }
  const result = new Map<string, LogisticsMaterialRoutePlacement>();
  const visited = new Set<string>();
  const walk = (first: LogisticsMaterialPathEntry) => {
    if (visited.has(first.id)) return;
    let entry: LogisticsMaterialPathEntry | undefined = first;
    // AI-REMOVED 2026-09-10:
    // Reason: 相位改为收集完整线路后按索引赋值，旧递增计数器退役。
    // Trigger: 支架必须提前知道下一转角或设备端点的位置。
    // Evidence: 单向边走边写无法避让尚未访问的必设点。
    // Replacement: 下方 route.forEach 的 start 索引。
    // Risk: Low; Human Review: Required
    // Original code:
    // let start = 0;
    // start += 1;
    const route: LogisticsMaterialPathEntry[] = [];
    while (entry && !visited.has(entry.id)) {
      visited.add(entry.id);
      route.push(entry);
      const next = inputs.get(`${entry.kind}:${entry.output}`);
      entry = next?.length === 1 && outputs.get(`${entry.kind}:${entry.output}`)?.length === 1 ? next[0] : undefined;
    }
    const closed = entry?.id === first.id;
    const supports = resolveLogisticsPipeSupports(route, closed);
    route.forEach((segment, start) => result.set(segment.id, {
      kind: segment.kind, shape: segment.shape, rotation: segment.rotation, start, routeId: first.id,
      support: supports.has(start),
      marker: start % 6 === 3,
    }));
  };
  for (const entry of ordered) {
    if (outputs.get(`${entry.kind}:${entry.input}`)?.length !== 1
      || inputs.get(`${entry.kind}:${entry.input}`)?.length !== 1) walk(entry);
  }
  for (const entry of ordered) walk(entry);
  return result;
}

/** 必设点与设备端点分隔计数区间；30 格候选落入下一锚点的 15 格以内时舍弃。 */
function resolveLogisticsPipeSupports(route: readonly LogisticsMaterialPathEntry[], closed: boolean): ReadonlySet<number> {
  const supports = new Set<number>();
  if (route[0]?.kind !== "pipe") return supports;
  const anchors = new Set<number>();
  route.forEach((entry, index) => {
    if (entry.shape !== "straight") { anchors.add(index); supports.add(index); }
  });
  if (!closed) {
    anchors.add(0);
    anchors.add(route.length - 1);
    if (!route[0]?.inputConnectedToDevice) supports.add(0);
    if (!route[route.length - 1]?.outputConnectedToDevice) supports.add(route.length - 1);
  }
  const ordered = [...anchors].sort((a, b) => a - b);
  if (closed && ordered.length === 0) ordered.push(0);
  const intervals = closed ? ordered.length : ordered.length - 1;
  for (let index = 0; index < intervals; index++) {
    const start = ordered[index]!;
    const end = ordered[index + 1] ?? ordered[0]! + route.length;
    for (let at = start + 30; at < end - 15; at += 30) supports.add(at % route.length);
  }
  return supports;
}
