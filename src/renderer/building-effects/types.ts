export interface HeightField {
  file: string;
  width: number;
  height: number;
  min: number;
  max: number;
  pivot: [number, number];
  center: [number, number];
  pixelsPerCell: number;
}

export interface EffectTransform {
  position: [number, number, number];
  yaw: number;
}

export interface BuildingEffectPort extends EffectTransform {
  role: 'input' | 'output';
  index: number;
  bindings: Record<'on' | 'off' | 'activateOn' | 'activateOff', string | null>;
}

export interface BuildingHeightView {
  footprint: { left: number; top: number; width: number; height: number };
  origin: [number, number];
  fields: Record<string, HeightField>;
  stateMapping: Record<string, string | null>;
  epsilon: number;
  variants: Record<string, BuildingEffectPort[]>;
  rings: (EffectTransform & { statusKey: number; resourceId: string })[];
  coordinateSpace?: 'project-reflected-source' | 'contract2-canonical';
}

export interface EffectFrame {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  durationMs: number;
}

export interface BuildingEffectResource {
  height: HeightField;
  pages: { file: string; width: number; height: number }[];
  frames: EffectFrame[];
  playback: { mode: string; durationMs: number; staticFrame: number };
  coordinateSpace?: 'project-reflected-source' | 'contract2-canonical';
}

export interface BuildingEffectsManifest {
  schemaVersion: number;
  definitions: Record<string, string>;
  views: Record<string, BuildingHeightView>;
  effects: Record<string, BuildingEffectResource>;
  heightMin: number;
  heightMax: number;
}

export interface SurfacePlacement {
  id: string;
  field: HeightField;
  x: number;
  y: number;
  rotation: number;
  baseY: number;
}

export interface EffectPlacement {
  id: string;
  resourceId: string;
  x: number;
  y: number;
  rotation: number;
  baseY: number;
  epsilon: number;
  ring: boolean;
}

export interface WorldBounds { left: number; top: number; right: number; bottom: number }
