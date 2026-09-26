import type { GridRect } from "@/domain/shared/grid";
import { areGridRectsIntersecting } from "@/shared/geometry/power-range";

interface AudioPosition { readonly entity: { readonly id: string }; readonly rect: GridRect }
interface RankedDevice { readonly id: string; readonly distance: number }

/** 屏内最近 10 台原音量；余下最近 10 台为 20%，屏外设备只进入后者。 */
export function selectDeviceAudioGains(devices: readonly AudioPosition[], viewport: GridRect): Map<string, number> {
  const foreground: RankedDevice[] = [], nearest: RankedDevice[] = [];
  const x = viewport.x + viewport.width / 2, y = viewport.y + viewport.height / 2;
  for (const { entity, rect } of devices) {
    const candidate = { id: entity.id, distance: (rect.x + rect.width / 2 - x) ** 2 + (rect.y + rect.height / 2 - y) ** 2 };
    if (areGridRectsIntersecting(viewport, rect)) insertNearest(foreground, candidate, 10);
    insertNearest(nearest, candidate, 20);
  }
  const gains = new Map(foreground.map(({ id }) => [id, 1]));
  let quiet = 0;
  for (const { id } of nearest) {
    if (gains.has(id)) continue;
    gains.set(id, 0.2);
    if (++quiet === 10) break;
  }
  return gains;
}

function insertNearest(list: RankedDevice[], candidate: RankedDevice, limit: number): void {
  // 固定大小的候选列表避免每次视口刷新对整个基地排序；同距以 ID 保持稳定。
  const index = list.findIndex((entry) => candidate.distance < entry.distance
    || (candidate.distance === entry.distance && candidate.id < entry.id));
  if (index === -1) {
    if (list.length < limit) list.push(candidate);
  } else {
    list.splice(index, 0, candidate);
    if (list.length > limit) list.pop();
  }
}
