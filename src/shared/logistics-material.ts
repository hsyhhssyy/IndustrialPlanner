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

export interface LogisticsMaterialEntityState extends LogisticsMaterialPlacement {
  readonly color: string;
}

export interface LogisticsMaterialFrameState {
  readonly entities: ReadonlyMap<string, LogisticsMaterialEntityState>;
  readonly beltSeconds: number;
  readonly pipeSeconds: number;
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
}

/** 每节累计一个材质单位，独立于货物沿圆弧移动的几何距离。闭环在稳定 ID 处切开。 */
export function resolveLogisticsMaterialPlacements(
  entries: readonly LogisticsMaterialPathEntry[],
): ReadonlyMap<string, LogisticsMaterialPlacement> {
  const ordered = [...entries].sort((a, b) => a.id.localeCompare(b.id));
  const inputs = new Map<string, LogisticsMaterialPathEntry[]>();
  const outputs = new Set(entries.map((entry) => `${entry.kind}:${entry.output}`));
  for (const entry of ordered) {
    const key = `${entry.kind}:${entry.input}`;
    const values = inputs.get(key) ?? [];
    values.push(entry);
    inputs.set(key, values);
  }
  const result = new Map<string, LogisticsMaterialPlacement>();
  const walk = (first: LogisticsMaterialPathEntry) => {
    let entry: LogisticsMaterialPathEntry | undefined = first;
    let start = 0;
    while (entry && !result.has(entry.id)) {
      result.set(entry.id, {
        kind: entry.kind, shape: entry.shape, rotation: entry.rotation, start,
        support: entry.shape !== "straight" || start % 3 === 0,
        marker: entry.shape !== "straight" || start % 6 === 3,
      });
      start += 1;
      const next = inputs.get(`${entry.kind}:${entry.output}`);
      entry = next?.length === 1 ? next[0] : undefined;
    }
  };
  for (const entry of ordered) if (!outputs.has(`${entry.kind}:${entry.input}`)) walk(entry);
  for (const entry of ordered) walk(entry);
  return result;
}
