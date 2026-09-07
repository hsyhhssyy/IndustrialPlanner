// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { formatPwaBytes, PwaController } from "@/app/pwa/pwa-controller";

const originalServiceWorkerDescriptor = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");
const originalUserAgentDescriptor = Object.getOwnPropertyDescriptor(navigator, "userAgent");
const originalMatchMediaDescriptor = Object.getOwnPropertyDescriptor(window, "matchMedia");

describe("PwaController", () => {
  beforeEach(() => {
    if (originalServiceWorkerDescriptor === undefined) {
      delete (navigator as unknown as { serviceWorker?: ServiceWorkerContainer }).serviceWorker;
    } else {
      Object.defineProperty(navigator, "serviceWorker", originalServiceWorkerDescriptor);
    }

    if (originalUserAgentDescriptor !== undefined) {
      Object.defineProperty(navigator, "userAgent", originalUserAgentDescriptor);
    }

    if (originalMatchMediaDescriptor === undefined) {
      delete (window as unknown as { matchMedia?: typeof window.matchMedia }).matchMedia;
    } else {
      Object.defineProperty(window, "matchMedia", originalMatchMediaDescriptor);
    }

    window.localStorage.clear();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("formats byte counts for progress UI", () => {
    expect(formatPwaBytes(0)).toBe("0 B");
    expect(formatPwaBytes(512)).toBe("512 B");
    expect(formatPwaBytes(1536)).toBe("1.5 KB");
    expect(formatPwaBytes(2 * 1024 * 1024)).toBe("2.0 MB");
  });

  it("marks unsupported browsers without changing the persisted choice", () => {
    const controller = new PwaController();

    controller.initialize();

    expect(controller.offlineStatus).toBe("unsupported");
    expect(controller.offlinePreference).toBe("unknown");
  });

  it("persists declined offline mode", () => {
    const controller = new PwaController();

    controller.declineOfflineMode();

    const nextController = new PwaController();
    expect(nextController.offlinePreference).toBe("declined");
    expect(nextController.offlineStatus).toBe("not-enabled");
  });

  it("persists dismissed desktop install prompts", () => {
    const controller = new PwaController();

    controller.dismissDesktopInstallPrompt();

    const nextController = new PwaController();
    expect(nextController.desktopInstallPromptDismissed).toBe(true);
  });

  it("keeps online animation toggles immediate when offline mode is not enabled", () => {
    let animationsEnabled = false;
    const controller = new PwaController({
      readEnabled: () => animationsEnabled,
      writeEnabled: (value) => {
        animationsEnabled = value;
      },
    });

    controller.setDeviceAnimationsEnabled(true);

    expect(controller.deviceAnimationsSettingValue).toBe(true);
    expect(controller.deviceAnimationStatus).toBe("complete");
    expect(animationsEnabled).toBe(true);
  });

  it("preserves PWA animation intent while gating actual playback until the package is complete", () => {
    vi.stubEnv("BASE_URL", "/");
    vi.stubEnv("DEV", false);
    window.localStorage.setItem("industrial-planner-pwa-preference", JSON.stringify({
      deviceAnimationsRequested: true,
      offlineMode: "accepted",
    }));
    const worker = createServiceWorkerMock();
    const registration = createServiceWorkerRegistrationMock({
      active: worker,
      installing: null,
      waiting: null,
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: createServiceWorkerContainerMock({
        controller: worker,
        registration,
      }),
    });
    let animationsEnabled = true;
    const controller = new PwaController({
      readEnabled: () => animationsEnabled,
      writeEnabled: (value) => {
        animationsEnabled = value;
      },
    });

    expect(controller.deviceAnimationsSettingValue).toBe(true);
    expect(animationsEnabled).toBe(false);

    deliverServiceWorkerMessage(controller, {
      type: "PWA_PRECACHE_PROGRESS",
      cacheName: "industrial-planner-animation-precache-current",
      completedBytes: 128,
      completedFiles: 1,
      currentUrl: "3d-top-view/animations/page-00.webp",
      task: "animation",
      totalBytes: 256,
      totalFiles: 2,
    });

    expect(controller.deviceAnimationStatus).toBe("downloading");
    expect(animationsEnabled).toBe(false);

    deliverServiceWorkerMessage(controller, {
      type: "PWA_PRECACHE_DONE",
      cacheName: "industrial-planner-animation-precache-current",
      task: "animation",
      totalBytes: 256,
      totalFiles: 2,
    });

    expect(controller.deviceAnimationStatus).toBe("complete");
    expect(controller.deviceAnimationsSettingValue).toBe(true);
    expect(animationsEnabled).toBe(true);
  });

  it("cancels the shared animation task without losing the persisted off state", () => {
    vi.stubEnv("BASE_URL", "/");
    vi.stubEnv("DEV", false);
    window.localStorage.setItem("industrial-planner-pwa-preference", JSON.stringify({
      deviceAnimationsRequested: true,
      offlineMode: "accepted",
    }));
    const worker = createServiceWorkerMock();
    const registration = createServiceWorkerRegistrationMock({
      active: worker,
      installing: null,
      waiting: null,
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: createServiceWorkerContainerMock({
        controller: worker,
        registration,
      }),
    });
    let animationsEnabled = true;
    const controller = new PwaController({
      readEnabled: () => animationsEnabled,
      writeEnabled: (value) => {
        animationsEnabled = value;
      },
    });

    controller.setDeviceAnimationsEnabled(false);

    expect(worker.postMessage).toHaveBeenCalledWith({ type: "PWA_ANIMATION_CACHE_CANCEL" });
    expect(controller.deviceAnimationsSettingValue).toBe(false);
    expect(controller.deviceAnimationStatus).toBe("idle");
    expect(animationsEnabled).toBe(false);
    expect(JSON.parse(window.localStorage.getItem("industrial-planner-pwa-preference") ?? "null"))
      .toMatchObject({ deviceAnimationsRequested: false });
  });

  it("checks for a PWA update before starting the animation package", async () => {
    vi.stubEnv("BASE_URL", "/");
    vi.stubEnv("DEV", false);
    window.localStorage.setItem("industrial-planner-pwa-preference", JSON.stringify({
      deviceAnimationsRequested: false,
      offlineMode: "accepted",
    }));
    const worker = createServiceWorkerMock();
    const registration = createServiceWorkerRegistrationMock({
      active: worker,
      installing: null,
      waiting: null,
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: createServiceWorkerContainerMock({
        controller: worker,
        registration,
      }),
    });
    let animationsEnabled = false;
    const controller = new PwaController({
      readEnabled: () => animationsEnabled,
      writeEnabled: (value) => {
        animationsEnabled = value;
      },
    });

    controller.setDeviceAnimationsEnabled(true);

    await vi.waitFor(() => {
      expect(registration.update).toHaveBeenCalledTimes(1);
      expect(worker.postMessage).toHaveBeenCalledWith({ type: "PWA_ANIMATION_CACHE_START" });
    });
    expect(controller.deviceAnimationStatus).toBe("downloading");
    expect(animationsEnabled).toBe(false);
  });

  it("preempts completed animation playback when a core update starts", () => {
    vi.stubEnv("BASE_URL", "/");
    vi.stubEnv("DEV", false);
    window.localStorage.setItem("industrial-planner-pwa-preference", JSON.stringify({
      deviceAnimationsRequested: true,
      offlineMode: "accepted",
    }));
    const worker = createServiceWorkerMock();
    const registration = createServiceWorkerRegistrationMock({
      active: worker,
      installing: null,
      waiting: null,
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: createServiceWorkerContainerMock({
        controller: worker,
        registration,
      }),
    });
    let animationsEnabled = true;
    const controller = new PwaController({
      readEnabled: () => animationsEnabled,
      writeEnabled: (value) => {
        animationsEnabled = value;
      },
    });

    deliverServiceWorkerMessage(controller, {
      type: "PWA_PRECACHE_DONE",
      cacheName: "industrial-planner-animation-precache-current",
      task: "animation",
      totalBytes: 256,
      totalFiles: 2,
    });
    expect(animationsEnabled).toBe(true);

    deliverServiceWorkerMessage(controller, {
      type: "PWA_PRECACHE_PROGRESS",
      cacheName: "industrial-planner-precache-next",
      completedBytes: 64,
      completedFiles: 1,
      currentUrl: "assets/index.js",
      task: "core",
      totalBytes: 512,
      totalFiles: 8,
    });

    expect(controller.deviceAnimationStatus).toBe("preempted-by-update");
    expect(controller.deviceAnimationsSettingValue).toBe(true);
    expect(controller.progress?.task).toBe("core");
    expect(animationsEnabled).toBe(false);
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "PWA_ANIMATION_CACHE_CANCEL" });
  });

  it("detects standalone display mode during construction", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn((query: string) => ({
        matches: query === "(display-mode: standalone)",
      })),
    });

    const controller = new PwaController();

    expect(controller.standalone).toBe(true);
  });

  it("selects the Apple install guide for unsupported fullscreen on iPhone", () => {
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
    });
    const controller = new PwaController();

    controller.openFullscreenNotice("unsupported");

    expect(controller.fullscreenNotice).toBe("apple-mobile-install");

    controller.closeFullscreenNotice();

    expect(controller.fullscreenNotice).toBeNull();
  });

  it("separates generic unsupported and rejected fullscreen notices", () => {
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36",
    });
    const controller = new PwaController();

    controller.openFullscreenNotice("unsupported");
    expect(controller.fullscreenNotice).toBe("unsupported");

    controller.openFullscreenNotice("rejected");
    expect(controller.fullscreenNotice).toBe("request-rejected");
  });

  it("reports latest version when a manual update check finds no waiting worker", async () => {
    vi.stubEnv("BASE_URL", "/");
    vi.stubEnv("DEV", false);

    const registration = createServiceWorkerRegistrationMock({
      active: {} as ServiceWorker,
      installing: null,
      waiting: null,
    });
    const serviceWorker = createServiceWorkerContainerMock({
      controller: {} as ServiceWorker,
      registration,
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: serviceWorker,
    });

    const controller = new PwaController();
    controller.offlinePreference = "accepted";
    controller.offlineStatus = "enabled";
    (controller as unknown as { registration: ServiceWorkerRegistration }).registration = registration;

    await controller.checkForUpdate();

    expect(registration.update).toHaveBeenCalledTimes(1);
    expect(controller.offlineStatus).toBe("up-to-date");
  });

  it("does not report latest version for background update checks", async () => {
    vi.stubEnv("BASE_URL", "/");
    vi.stubEnv("DEV", false);

    const registration = createServiceWorkerRegistrationMock({
      active: {} as ServiceWorker,
      installing: null,
      waiting: null,
    });
    const serviceWorker = createServiceWorkerContainerMock({
      controller: {} as ServiceWorker,
      registration,
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: serviceWorker,
    });

    const controller = new PwaController();
    controller.offlinePreference = "accepted";
    controller.offlineStatus = "enabled";
    (controller as unknown as { registration: ServiceWorkerRegistration }).registration = registration;

    await controller.checkForUpdate(false);

    expect(registration.update).toHaveBeenCalledTimes(1);
    expect(controller.offlineStatus).toBe("enabled");
  });
});

function createServiceWorkerRegistrationMock(state: {
  readonly active: ServiceWorker | null;
  readonly installing: ServiceWorker | null;
  readonly waiting: ServiceWorker | null;
}): ServiceWorkerRegistration {
  const update = vi.fn<() => Promise<ServiceWorkerRegistration>>();
  const registration = {
    active: state.active,
    addEventListener: vi.fn(),
    installing: state.installing,
    removeEventListener: vi.fn(),
    update,
    waiting: state.waiting,
  } as unknown as ServiceWorkerRegistration;

  update.mockResolvedValue(registration);
  return registration;
}

function createServiceWorkerMock(): ServiceWorker {
  return {
    addEventListener: vi.fn(),
    postMessage: vi.fn(),
  } as unknown as ServiceWorker;
}

function deliverServiceWorkerMessage(controller: PwaController, data: unknown): void {
  const controllerWithMessageHandler = controller as unknown as {
    handleServiceWorkerMessage: (event: MessageEvent<unknown>) => void;
  };

  controllerWithMessageHandler.handleServiceWorkerMessage({ data } as MessageEvent<unknown>);
}

function createServiceWorkerContainerMock(state: {
  readonly controller: ServiceWorker | null;
  readonly registration: ServiceWorkerRegistration;
}): ServiceWorkerContainer {
  return {
    addEventListener: vi.fn(),
    controller: state.controller,
    getRegistrations: vi.fn(async () => [state.registration]),
    register: vi.fn(async () => state.registration),
    removeEventListener: vi.fn(),
  } as unknown as ServiceWorkerContainer;
}
