import { describe, expect, it } from "vitest";
import {
  buildRendererDiagnosticsHudModel,
  createRendererDiagnosticsHud,
} from "@/renderer/host/renderer-diagnostics-hud";
import type { FpsMeter } from "@/renderer/host/fps-meter";

describe("renderer diagnostics hud", () => {
  it("builds the default fps item", () => {
    const model = buildRendererDiagnosticsHudModel({
      fpsLabel: "FPS:58",
    });

    expect(model.items).toEqual([
      {
        id: "fps",
        label: "FPS:58",
        fill: 0x7fe0b0,
      },
    ]);
    expect(model.signature).toBe("fps:FPS:58");
  });

  it("can hide the entire hud through settings", () => {
    const model = buildRendererDiagnosticsHudModel(
      {
        fpsLabel: "FPS:58",
      },
      {
        visible: false,
      },
    );

    expect(model.items).toEqual([]);
    expect(model.signature).toBe("hidden");
  });

  it("can hide individual items through settings", () => {
    const model = buildRendererDiagnosticsHudModel(
      {
        fpsLabel: "FPS:58",
      },
      {
        items: {
          fps: false,
        },
      },
    );

    expect(model.items).toEqual([]);
    expect(model.signature).toBe("empty");
  });

  it("updates the hud snapshot when the fps label changes", () => {
    let currentLabel = "FPS:0";
    const meter: FpsMeter = {
      recordFrame() {
        currentLabel = "FPS:61";
        return true;
      },
      getLabel() {
        return currentLabel;
      },
    };
    const hud = createRendererDiagnosticsHud({
      fpsMeter: meter,
    });

    expect(hud.recordFrame(16)).toBe(true);

    const model = buildRendererDiagnosticsHudModel({
      fpsLabel: currentLabel,
    });
    expect(model.signature).toBe("fps:FPS:61");
  });

  it("tracks future settings toggles without changing the runtime surface", () => {
    const meter: FpsMeter = {
      recordFrame() {
        return false;
      },
      getLabel() {
        return "FPS:61";
      },
    };
    const hud = createRendererDiagnosticsHud({
      fpsMeter: meter,
    });

    expect(
      hud.setSettings({
        items: {
          fps: false,
        },
      }),
    ).toBe(true);
    expect(
      hud.setSettings({
        items: {
          fps: false,
        },
      }),
    ).toBe(false);
  });
});
