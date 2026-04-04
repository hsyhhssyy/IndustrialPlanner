import { Container, Graphics, Text } from "pixi.js";
import type {
  DestroyOptions,
  FillInput,
  StrokeInput,
  TextStyleOptions,
} from "pixi.js";
import {
  createFpsMeter,
  type CreateFpsMeterOptions,
  type FpsMeter,
} from "@/renderer/host/fps-meter";

const DIAGNOSTICS_HUD_TEXT_STYLE: TextStyleOptions = {
  fill: 0x7fe0b0,
  fontFamily:
    '"IBM Plex Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
  fontSize: 12,
  fontWeight: "600",
};
const DIAGNOSTICS_HUD_BACKGROUND_FILL: FillInput = {
  color: 0x091018,
  alpha: 0.78,
};
const DIAGNOSTICS_HUD_BACKGROUND_STROKE: StrokeInput = {
  width: 1,
  color: 0x284457,
  alpha: 0.92,
};
const PIXI_DISPLAY_OBJECT_DESTROY_OPTIONS: DestroyOptions = {
  children: true,
  context: true,
  style: true,
  texture: false,
  textureSource: false,
};
const DIAGNOSTICS_HUD_MARGIN = 12;
const DIAGNOSTICS_HUD_PADDING_X = 8;
const DIAGNOSTICS_HUD_PADDING_Y = 6;
const DIAGNOSTICS_HUD_ITEM_GAP = 4;

export type RendererDiagnosticsHudItemId = "fps";

export interface RendererDiagnosticsHudItem {
  id: RendererDiagnosticsHudItemId;
  label: string;
  fill: number;
}

export interface RendererDiagnosticsHudModel {
  items: RendererDiagnosticsHudItem[];
  signature: string;
}

export interface RendererDiagnosticsHudSnapshot {
  fpsLabel: string;
}

export interface RendererDiagnosticsHudSettings {
  visible: boolean;
  items: Partial<Record<RendererDiagnosticsHudItemId, boolean>>;
}

export interface CreateRendererDiagnosticsHudOptions {
  settings?: Partial<RendererDiagnosticsHudSettings>;
  fpsMeter?: FpsMeter;
  fpsMeterOptions?: CreateFpsMeterOptions;
}

export interface RendererDiagnosticsHud {
  recordFrame: (now: number) => boolean;
  setSettings: (settings: Partial<RendererDiagnosticsHudSettings>) => boolean;
  syncLayer: (
    layer: Container,
    viewportWidth: number,
    force?: boolean,
  ) => boolean;
}

interface RendererDiagnosticsHudItemDefinition {
  id: RendererDiagnosticsHudItemId;
  enabledByDefault: boolean;
  fill: number;
  getLabel: (snapshot: RendererDiagnosticsHudSnapshot) => string | null;
}

const HUD_ITEM_DEFINITIONS: readonly RendererDiagnosticsHudItemDefinition[] = [
  {
    id: "fps",
    enabledByDefault: true,
    fill: 0x7fe0b0,
    getLabel: (snapshot) => snapshot.fpsLabel,
  },
];

export const DEFAULT_RENDERER_DIAGNOSTICS_HUD_SETTINGS: RendererDiagnosticsHudSettings =
  {
    visible: true,
    items: {
      fps: true,
    },
  };

function clearContainer(container: Container): void {
  const children = container.removeChildren();

  for (const child of children) {
    child.destroy(PIXI_DISPLAY_OBJECT_DESTROY_OPTIONS);
  }
}

function mergeRendererDiagnosticsHudSettings(
  base: RendererDiagnosticsHudSettings,
  override: Partial<RendererDiagnosticsHudSettings> = {},
): RendererDiagnosticsHudSettings {
  return {
    visible: override.visible ?? base.visible,
    items: {
      ...base.items,
      ...(override.items ?? {}),
    },
  };
}

function getRendererDiagnosticsHudSettingsSignature(
  settings: RendererDiagnosticsHudSettings,
): string {
  const itemSignature = HUD_ITEM_DEFINITIONS.map((definition) => {
    const enabled = settings.items[definition.id] ?? definition.enabledByDefault;
    return `${definition.id}:${enabled ? "1" : "0"}`;
  }).join("|");

  return `${settings.visible ? "visible" : "hidden"}|${itemSignature}`;
}

export function buildRendererDiagnosticsHudModel(
  snapshot: RendererDiagnosticsHudSnapshot,
  settings: Partial<RendererDiagnosticsHudSettings> = {},
): RendererDiagnosticsHudModel {
  const resolvedSettings = mergeRendererDiagnosticsHudSettings(
    DEFAULT_RENDERER_DIAGNOSTICS_HUD_SETTINGS,
    settings,
  );

  if (!resolvedSettings.visible) {
    return {
      items: [],
      signature: "hidden",
    };
  }

  const items = HUD_ITEM_DEFINITIONS.flatMap((definition) => {
    const enabled =
      resolvedSettings.items[definition.id] ?? definition.enabledByDefault;

    if (!enabled) {
      return [];
    }

    const label = definition.getLabel(snapshot);

    if (!label) {
      return [];
    }

    return [
      {
        id: definition.id,
        label,
        fill: definition.fill,
      } satisfies RendererDiagnosticsHudItem,
    ];
  });

  return {
    items,
    signature:
      items.length === 0
        ? "empty"
        : items.map((item) => `${item.id}:${item.label}`).join("|"),
  };
}

function renderRendererDiagnosticsHudLayer(
  layer: Container,
  model: RendererDiagnosticsHudModel,
  viewportWidth: number,
): void {
  clearContainer(layer);

  if (model.items.length === 0) {
    return;
  }

  const texts = model.items.map(
    (item) =>
      new Text({
        text: item.label,
        style: {
          ...DIAGNOSTICS_HUD_TEXT_STYLE,
          fill: item.fill,
        },
      }),
  );
  const maxTextWidth = texts.reduce(
    (currentMax, text) => Math.max(currentMax, text.width),
    0,
  );
  const totalTextHeight = texts.reduce(
    (total, text) => total + text.height,
    0,
  );
  const totalGapHeight =
    Math.max(0, texts.length - 1) * DIAGNOSTICS_HUD_ITEM_GAP;
  const backgroundWidth = Math.ceil(maxTextWidth + DIAGNOSTICS_HUD_PADDING_X * 2);
  const backgroundHeight = Math.ceil(
    totalTextHeight + totalGapHeight + DIAGNOSTICS_HUD_PADDING_Y * 2,
  );
  const backgroundX = Math.max(
    DIAGNOSTICS_HUD_MARGIN,
    viewportWidth - backgroundWidth - DIAGNOSTICS_HUD_MARGIN,
  );
  const backgroundY = DIAGNOSTICS_HUD_MARGIN;
  const background = new Graphics();

  background
    .roundRect(
      backgroundX,
      backgroundY,
      backgroundWidth,
      backgroundHeight,
      8,
    )
    .fill(DIAGNOSTICS_HUD_BACKGROUND_FILL)
    .stroke(DIAGNOSTICS_HUD_BACKGROUND_STROKE);
  layer.addChild(background);

  let currentY = backgroundY + DIAGNOSTICS_HUD_PADDING_Y;

  for (const text of texts) {
    text.x = backgroundX + DIAGNOSTICS_HUD_PADDING_X;
    text.y = currentY;
    currentY += text.height + DIAGNOSTICS_HUD_ITEM_GAP;
    layer.addChild(text);
  }
}

export function createRendererDiagnosticsHud(
  options: CreateRendererDiagnosticsHudOptions = {},
): RendererDiagnosticsHud {
  const fpsMeter =
    options.fpsMeter ?? createFpsMeter(options.fpsMeterOptions);
  let snapshot: RendererDiagnosticsHudSnapshot = {
    fpsLabel: fpsMeter.getLabel(),
  };
  let settings = mergeRendererDiagnosticsHudSettings(
    DEFAULT_RENDERER_DIAGNOSTICS_HUD_SETTINGS,
    options.settings,
  );
  let settingsSignature = getRendererDiagnosticsHudSettingsSignature(settings);
  let lastRenderedModelSignature = "";
  let lastRenderedViewportWidth = -1;

  return {
    recordFrame(now) {
      fpsMeter.recordFrame(now);
      const nextFpsLabel = fpsMeter.getLabel();

      if (nextFpsLabel === snapshot.fpsLabel) {
        return false;
      }

      snapshot = {
        ...snapshot,
        fpsLabel: nextFpsLabel,
      };
      return true;
    },
    setSettings(nextSettings) {
      const mergedSettings = mergeRendererDiagnosticsHudSettings(
        settings,
        nextSettings,
      );
      const nextSignature =
        getRendererDiagnosticsHudSettingsSignature(mergedSettings);

      if (nextSignature === settingsSignature) {
        return false;
      }

      settings = mergedSettings;
      settingsSignature = nextSignature;
      return true;
    },
    syncLayer(layer, viewportWidth, force = false) {
      const model = buildRendererDiagnosticsHudModel(snapshot, settings);

      if (
        !force &&
        model.signature === lastRenderedModelSignature &&
        viewportWidth === lastRenderedViewportWidth
      ) {
        return false;
      }

      renderRendererDiagnosticsHudLayer(layer, model, viewportWidth);
      lastRenderedModelSignature = model.signature;
      lastRenderedViewportWidth = viewportWidth;
      return true;
    },
  };
}
