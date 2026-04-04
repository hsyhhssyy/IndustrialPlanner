import { describe, expect, it } from "vitest";
import { createFpsMeter } from "@/renderer/host/fps-meter";

describe("fps meter", () => {
  it("starts with a zero fps label", () => {
    const meter = createFpsMeter();

    expect(meter.getLabel()).toBe("FPS:0");
  });

  it("publishes a rounded fps label from a rolling window", () => {
    const meter = createFpsMeter({
      sampleWindowMs: 1000,
      displayUpdateIntervalMs: 200,
    });

    meter.recordFrame(0);
    meter.recordFrame(50);
    meter.recordFrame(100);
    meter.recordFrame(150);
    const changed = meter.recordFrame(200);

    expect(changed).toBe(true);
    expect(meter.getLabel()).toBe("FPS:20");
  });

  it("drops old frames outside the sample window", () => {
    const meter = createFpsMeter({
      sampleWindowMs: 300,
      displayUpdateIntervalMs: 1,
    });

    meter.recordFrame(0);
    meter.recordFrame(100);
    meter.recordFrame(200);
    meter.recordFrame(300);
    expect(meter.getLabel()).toBe("FPS:10");

    meter.recordFrame(600);
    meter.recordFrame(900);
    meter.recordFrame(1200);

    expect(meter.getLabel()).toBe("FPS:3");
  });
});
