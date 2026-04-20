import { describe, expect, it, vi } from "vitest";

import {
  resetScreenProfileConsoleDiagnosticsForTest,
  resolveScreenProfile,
  resolveScreenProfileFromWindow,
} from "@/shared/browser/screen-profile";

function createSource(options: {
  width: number;
  height: number;
  devicePixelRatio?: number;
  userAgent?: string;
  mobileHint?: boolean;
  maxTouchPoints?: number;
  coarsePointer?: boolean;
  hoverNone?: boolean;
}) {
  const {
    width,
    height,
    devicePixelRatio = 1,
    userAgent = "",
    mobileHint,
    maxTouchPoints = 0,
    coarsePointer = false,
    hoverNone = false,
  } = options;

  return {
    innerWidth: width,
    innerHeight: height,
    devicePixelRatio,
    navigator: {
      maxTouchPoints,
      userAgent,
      userAgentData: {
        mobile: mobileHint,
      },
    },
    matchMedia: (query: string) => ({
      matches:
        (query === "(pointer: coarse)" && coarsePointer) ||
        (query === "(hover: none)" && hoverNone),
    }),
  };
}

function createWindowSource(options: {
  width: number;
  height: number;
  devicePixelRatio?: number;
  userAgent?: string;
  mobileHint?: boolean;
  maxTouchPoints?: number;
  coarsePointer?: boolean;
  hoverNone?: boolean;
}) {
  return createSource(options) as unknown as Window;
}

describe("resolveScreenProfile", () => {
  it("classifies a phone viewport in portrait mode", () => {
    const profile = resolveScreenProfile(
      createSource({
        width: 390,
        height: 844,
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
        mobileHint: true,
        maxTouchPoints: 5,
        coarsePointer: true,
        hoverNone: true,
      }),
    );

    expect(profile.deviceClass).toBe("mobile");
    expect(profile.screenShape).toBe("portrait");
    expect(profile.hasTouch).toBe(true);
  });

  it("classifies a tablet viewport in landscape mode", () => {
    const profile = resolveScreenProfile(
      createSource({
        width: 1180,
        height: 820,
        userAgent:
          "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
        maxTouchPoints: 5,
        coarsePointer: true,
        hoverNone: true,
      }),
    );

    expect(profile.deviceClass).toBe("tablet");
    expect(profile.screenShape).toBe("landscape");
  });

  it("classifies a desktop viewport even when the browser window is not very wide", () => {
    const profile = resolveScreenProfile(
      createSource({
        width: 900,
        height: 780,
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
      }),
    );

    expect(profile.deviceClass).toBe("desktop");
    expect(profile.screenShape).toBe("square");
  });

  it("marks nearly square screens as square", () => {
    const profile = resolveScreenProfile(
      createSource({
        width: 1024,
        height: 980,
        userAgent:
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
      }),
    );

    expect(profile.screenShape).toBe("square");
    expect(profile.aspectRatio).toBeLessThanOrEqual(1.15);
  });

  it("prefers a mobile classification for high-dpr touch screens with phone-sized css viewport", () => {
    const profile = resolveScreenProfile(
      createSource({
        width: 412,
        height: 915,
        devicePixelRatio: 3,
        userAgent:
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
        maxTouchPoints: 5,
        coarsePointer: true,
        hoverNone: true,
      }),
    );

    expect(profile.deviceClass).toBe("mobile");
    expect(profile.devicePixelRatio).toBe(3);
  });

  it("classifies a touch-enabled Windows desktop as desktop when pointer and hover still look desktop-like", () => {
    const profile = resolveScreenProfile(
      createSource({
        width: 1234,
        height: 899,
        devicePixelRatio: 1,
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0",
        maxTouchPoints: 20,
        coarsePointer: false,
        hoverNone: false,
      }),
    );

    expect(profile.hasTouch).toBe(true);
    expect(profile.deviceClass).toBe("desktop");
    expect(profile.screenShape).toBe("landscape");
  });

  it("logs concrete screen diagnostics to console only when values change", () => {
    resetScreenProfileConsoleDiagnosticsForTest();

    const consoleInfoSpy = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);

    const firstWindow = createWindowSource({
      width: 412,
      height: 915,
      devicePixelRatio: 3,
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
      maxTouchPoints: 5,
      coarsePointer: true,
      hoverNone: true,
    });

    resolveScreenProfileFromWindow(firstWindow);
    resolveScreenProfileFromWindow(firstWindow);

    expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "[industrial-planner:screen-profile]",
      expect.objectContaining({
        viewportWidth: 412,
        viewportHeight: 915,
        shorterSide: 412,
        devicePixelRatio: 3,
        hasTouch: true,
        deviceClass: "mobile",
        screenShape: "portrait",
      }),
    );

    const secondWindow = createWindowSource({
      width: 1180,
      height: 820,
      devicePixelRatio: 2,
      userAgent:
        "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
      coarsePointer: true,
      hoverNone: true,
    });

    resolveScreenProfileFromWindow(secondWindow);

    expect(consoleInfoSpy).toHaveBeenCalledTimes(2);

    consoleInfoSpy.mockRestore();
  });
});