import type {
  DeviceClass,
  ScreenProfile,
  ScreenShape,
} from "@/domain/app/types/screen-profile";

export interface ScreenProfileSource {
  readonly innerWidth: number;
  readonly innerHeight: number;
  readonly devicePixelRatio?: number;
  readonly navigator?: {
    readonly maxTouchPoints?: number;
    readonly userAgent?: string;
    readonly userAgentData?: {
      readonly mobile?: boolean;
    };
  };
  readonly matchMedia?: (query: string) => {
    readonly matches: boolean;
  };
}

interface ScreenProfileConsoleDiagnostics {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly shorterSide: number;
  readonly longerSide: number;
  readonly devicePixelRatio: number;
  readonly hasTouch: boolean;
  readonly coarsePointer: boolean;
  readonly hoverNone: boolean;
  readonly maxTouchPoints: number;
  readonly userAgent: string;
  readonly userAgentHints: {
    readonly mobile: boolean;
    readonly tablet: boolean;
    readonly desktop: boolean;
  };
  readonly deviceClass: DeviceClass;
  readonly screenShape: ScreenShape;
  readonly aspectRatio: number;
}

const SQUARE_ASPECT_RATIO_THRESHOLD = 1.2;
const MOBILE_MAX_SHORT_EDGE = 600;
const HIGH_DPR_MOBILE_MAX_SHORT_EDGE = 540;
const TABLET_MAX_SHORT_EDGE = 1024;
const MOBILE_MIN_DEVICE_PIXEL_RATIO = 2;
const SCREEN_PROFILE_LOG_PREFIX = "[industrial-planner:screen-profile]";

let lastScreenProfileConsoleSignature: string | null = null;

function resolveDevicePixelRatio(source: ScreenProfileSource): number {
  const devicePixelRatio = Number(source.devicePixelRatio ?? 1);

  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) {
    return 1;
  }

  return devicePixelRatio;
}

function resolveTouchCapability(source: ScreenProfileSource): boolean {
  const coarsePointer = source.matchMedia?.("(pointer: coarse)")?.matches ?? false;
  const hoverNone = source.matchMedia?.("(hover: none)")?.matches ?? false;
  const maxTouchPoints = source.navigator?.maxTouchPoints ?? 0;

  return coarsePointer || hoverNone || maxTouchPoints > 0;
}

function resolveDesktopInteractionHint(options: {
  readonly desktopHint: boolean;
  readonly source: ScreenProfileSource;
}) {
  const { desktopHint, source } = options;
  const coarsePointer = source.matchMedia?.("(pointer: coarse)")?.matches ?? false;
  const hoverNone = source.matchMedia?.("(hover: none)")?.matches ?? false;

  return desktopHint && !coarsePointer && !hoverNone;
}

function resolveUserAgentHints(source: ScreenProfileSource) {
  const userAgent = source.navigator?.userAgent ?? "";
  const userAgentMobile = source.navigator?.userAgentData?.mobile === true;
  const mobile =
    userAgentMobile ||
    /Android.+Mobile|iPhone|Windows Phone|Mobile\b/i.test(userAgent);
  const tablet =
    /iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(userAgent);
  const desktop =
    /Macintosh|Windows NT|X11|Linux x86_64/i.test(userAgent) && !mobile && !tablet;

  return {
    mobile,
    tablet,
    desktop,
  };
}

function resolveScreenShape(width: number, height: number): ScreenShape {
  const longerSide = Math.max(width, height);
  const shorterSide = Math.max(1, Math.min(width, height));
  const ratio = longerSide / shorterSide;

  if (ratio <= SQUARE_ASPECT_RATIO_THRESHOLD) {
    return "square";
  }

  return width >= height ? "landscape" : "portrait";
}

function createScreenProfileConsoleDiagnostics(options: {
  readonly source: ScreenProfileSource;
  readonly profile: ScreenProfile;
}): ScreenProfileConsoleDiagnostics {
  const { source, profile } = options;
  const viewportWidth = profile.viewportWidth;
  const viewportHeight = profile.viewportHeight;
  const shorterSide = Math.min(viewportWidth, viewportHeight);
  const longerSide = Math.max(viewportWidth, viewportHeight);
  const coarsePointer = source.matchMedia?.("(pointer: coarse)")?.matches ?? false;
  const hoverNone = source.matchMedia?.("(hover: none)")?.matches ?? false;
  const maxTouchPoints = source.navigator?.maxTouchPoints ?? 0;
  const userAgent = source.navigator?.userAgent ?? "";

  return {
    viewportWidth,
    viewportHeight,
    shorterSide,
    longerSide,
    devicePixelRatio: profile.devicePixelRatio,
    hasTouch: profile.hasTouch,
    coarsePointer,
    hoverNone,
    maxTouchPoints,
    userAgent,
    userAgentHints: resolveUserAgentHints(source),
    deviceClass: profile.deviceClass,
    screenShape: profile.screenShape,
    aspectRatio: profile.aspectRatio,
  };
}

function emitScreenProfileConsoleDiagnostics(options: {
  readonly source: ScreenProfileSource;
  readonly profile: ScreenProfile;
}) {
  const diagnostics = createScreenProfileConsoleDiagnostics(options);
  const nextSignature = JSON.stringify(diagnostics);

  if (nextSignature === lastScreenProfileConsoleSignature) {
    return;
  }

  lastScreenProfileConsoleSignature = nextSignature;
  console.info(SCREEN_PROFILE_LOG_PREFIX, diagnostics);
}

function resolveHighDprMobileHint(options: {
  readonly shorterSide: number;
  readonly hasTouch: boolean;
  readonly devicePixelRatio: number;
}) {
  const { shorterSide, hasTouch, devicePixelRatio } = options;

  return (
    hasTouch &&
    devicePixelRatio >= MOBILE_MIN_DEVICE_PIXEL_RATIO &&
    shorterSide <= HIGH_DPR_MOBILE_MAX_SHORT_EDGE
  );
}

export function resolveScreenProfile(source: ScreenProfileSource): ScreenProfile {
  const viewportWidth = Math.max(1, Math.round(source.innerWidth));
  const viewportHeight = Math.max(1, Math.round(source.innerHeight));
  const shorterSide = Math.min(viewportWidth, viewportHeight);
  const longerSide = Math.max(viewportWidth, viewportHeight);
  const hasTouch = resolveTouchCapability(source);
  const devicePixelRatio = resolveDevicePixelRatio(source);
  const hints = resolveUserAgentHints(source);

  let deviceClass: DeviceClass;

  if (hints.tablet) {
    if (shorterSide <= MOBILE_MAX_SHORT_EDGE) {
      deviceClass = "mobile";
    } else {
      deviceClass = "tablet";
    }
  } else if (hints.mobile) {
    deviceClass = "mobile";
  } else if (
    resolveHighDprMobileHint({
      shorterSide,
      hasTouch,
      devicePixelRatio,
    })
  ) {
    deviceClass = "mobile";
  } else if (shorterSide <= MOBILE_MAX_SHORT_EDGE) {
    deviceClass = "mobile";
  } else if (
    resolveDesktopInteractionHint({
      desktopHint: hints.desktop,
      source,
    })
  ) {
    deviceClass = "desktop";
  } else if (hasTouch && shorterSide <= TABLET_MAX_SHORT_EDGE) {
    deviceClass = "tablet";
  } else if (!hasTouch && longerSide >= 960) {
    deviceClass = "desktop";
  } else {
    deviceClass = hasTouch ? "tablet" : "desktop";
  }

  return {
    viewportWidth,
    viewportHeight,
    devicePixelRatio,
    deviceClass,
    screenShape: resolveScreenShape(viewportWidth, viewportHeight),
    aspectRatio: longerSide / Math.max(1, shorterSide),
    hasTouch,
  };
}

export function isMobileLandscapeScreenProfile(profile: Pick<ScreenProfile, "deviceClass" | "screenShape">): boolean {
  return profile.deviceClass === "mobile" && profile.screenShape === "landscape";
}

export function isMobilePortraitScreenProfile(profile: Pick<ScreenProfile, "deviceClass" | "screenShape">): boolean {
  return profile.deviceClass === "mobile" && profile.screenShape === "portrait";
}

export function isMobileOrTabletScreenProfile(profile: Pick<ScreenProfile, "deviceClass">): boolean {
  return profile.deviceClass === "mobile" || profile.deviceClass === "tablet";
}

export function isTouchScreenProfile(profile: Pick<ScreenProfile, "hasTouch">): boolean {
  return profile.hasTouch;
}

export function isTouchLandscapeScreenProfile(profile: Pick<ScreenProfile, "deviceClass" | "screenShape">): boolean {
  return isMobileOrTabletScreenProfile(profile) && profile.screenShape === "landscape";
}

export function resolveScreenProfileFromWindow(
  currentWindow: Window | undefined = typeof window === "undefined" ? undefined : window,
): ScreenProfile {
  if (!currentWindow) {
    return {
      viewportWidth: 1,
      viewportHeight: 1,
      devicePixelRatio: 1,
      deviceClass: "desktop",
      screenShape: "square",
      aspectRatio: 1,
      hasTouch: false,
    };
  }

  const profile = resolveScreenProfile(currentWindow);

  emitScreenProfileConsoleDiagnostics({
    source: currentWindow,
    profile,
  });

  return profile;
}

export function resetScreenProfileConsoleDiagnosticsForTest() {
  lastScreenProfileConsoleSignature = null;
}