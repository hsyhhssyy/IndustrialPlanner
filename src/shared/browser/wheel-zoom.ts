/** 将滚轮增量转换为缩放方向：1 放大，-1 缩小，0 不缩放。 */
export function resolveWheelZoomDirection(deltaY: number, inverted: boolean): -1 | 0 | 1 {
  if (!Number.isFinite(deltaY) || deltaY === 0) {
    return 0;
  }

  const zoomIn = inverted ? deltaY > 0 : deltaY < 0;
  return zoomIn ? 1 : -1;
}
