// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { formatPwaBytes, PwaController } from "@/app/pwa/pwa-controller";

describe("PwaController", () => {
  beforeEach(() => {
    window.localStorage.clear();
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
});
