export type DeviceClass = "mobile" | "tablet" | "desktop";

export type ScreenShape = "portrait" | "landscape" | "square";

export interface ScreenProfile {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly devicePixelRatio: number;
  readonly deviceClass: DeviceClass;
  readonly screenShape: ScreenShape;
  readonly aspectRatio: number;
  readonly hasTouch: boolean;
}
