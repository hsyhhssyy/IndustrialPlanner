import { makeAutoObservable, runInAction } from "mobx";

import { isRootPublicAssetBaseUrl } from "@/shared/browser/public-asset-url";
import { readFromLocalStorage, saveToLocalStorage } from "@/shared/storage";

const PWA_PREFERENCE_LOCAL_STORAGE_KEY = "industrial-planner-pwa-preference";
const UPDATE_POLL_INTERVAL_MS = 15 * 60 * 1000;

export type PwaOfflinePreference = "unknown" | "accepted" | "declined";

export type PwaOfflineStatus =
  | "unsupported"
  | "ready-to-enable"
  | "not-enabled"
  | "registering"
  | "installing"
  | "enabled"
  | "checking-update"
  | "up-to-date"
  | "update-available"
  | "updating"
  | "error";

export interface PwaProgress {
  readonly cacheName: string;
  readonly completedBytes: number;
  readonly completedFiles: number;
  readonly currentUrl: string | null;
  readonly totalBytes: number;
  readonly totalFiles: number;
}

interface PersistedPwaPreference {
  readonly desktopInstallPromptDismissed?: boolean;
  readonly offlineMode?: PwaOfflinePreference;
}

interface BeforeInstallPromptChoice {
  readonly outcome: "accepted" | "dismissed";
  readonly platform: string;
}

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: readonly string[];
  readonly userChoice: Promise<BeforeInstallPromptChoice>;
  prompt: () => Promise<void>;
}

type PwaServiceWorkerMessage =
  | {
    readonly type: "PWA_PRECACHE_PROGRESS";
    readonly cacheName: string;
    readonly completedBytes: number;
    readonly completedFiles: number;
    readonly currentUrl: string;
    readonly totalBytes: number;
    readonly totalFiles: number;
  }
  | {
    readonly type: "PWA_PRECACHE_DONE";
    readonly cacheName: string;
    readonly totalBytes: number;
    readonly totalFiles: number;
  }
  | {
    readonly type: "PWA_PRECACHE_ERROR";
    readonly cacheName: string;
    readonly message: string;
  }
  | {
    readonly type: "PWA_ACTIVATED";
    readonly cacheName: string;
  };

export class PwaController {
  public desktopInstallPromptDismissed = false;
  public errorMessage: string | null = null;
  public installPromptAvailable = false;
  public offlinePreference: PwaOfflinePreference = "unknown";
  public offlineStatus: PwaOfflineStatus = "ready-to-enable";
  public progress: PwaProgress | null = null;
  public standalone = false;

  private beforeInstallPromptEvent: BeforeInstallPromptEvent | null = null;
  private initialized = false;
  private pollIntervalId: number | null = null;
  private registration: ServiceWorkerRegistration | null = null;
  private removeRegistrationUpdateListener: (() => void) | null = null;
  private reloadAfterControllerChange = false;
  private waitingWorker: ServiceWorker | null = null;

  public constructor() {
    const persistedPreference = normalizePersistedPwaPreference(
      readFromLocalStorage<unknown>(PWA_PREFERENCE_LOCAL_STORAGE_KEY),
    );
    this.desktopInstallPromptDismissed = persistedPreference.desktopInstallPromptDismissed;
    this.offlinePreference = persistedPreference.offlineMode;
    this.offlineStatus = this.offlinePreference === "declined" ? "not-enabled" : "ready-to-enable";

    makeAutoObservable<
      PwaController,
      | "beforeInstallPromptEvent"
      | "initialized"
      | "pollIntervalId"
      | "registration"
      | "removeRegistrationUpdateListener"
      | "reloadAfterControllerChange"
      | "waitingWorker"
    >(
      this,
      {
        beforeInstallPromptEvent: false,
        initialized: false,
        pollIntervalId: false,
        registration: false,
        removeRegistrationUpdateListener: false,
        reloadAfterControllerChange: false,
        waitingWorker: false,
      },
      { autoBind: true },
    );
  }

  public get canPromptDesktopInstall(): boolean {
    return this.installPromptAvailable
      && !this.desktopInstallPromptDismissed
      && !this.standalone
      && this.offlineStatus !== "installing"
      && this.offlineStatus !== "registering"
      && this.offlineStatus !== "updating"
      && this.offlineStatus !== "update-available";
  }

  public get isOfflineModeAccepted(): boolean {
    return this.offlinePreference === "accepted";
  }

  public get shouldShowOfflinePrompt(): boolean {
    return this.offlinePreference === "unknown" && this.offlineStatus === "ready-to-enable";
  }

  public initialize(): void {
    if (this.initialized) {
      return;
    }

    this.initialized = true;
    this.standalone = resolveStandaloneMode();

    if (!isRootPublicAssetBaseUrl()) {
      this.offlineStatus = "unsupported";
      return;
    }

    if (isPwaDevelopmentServer()) {
      this.offlineStatus = "unsupported";
      void cleanupDevelopmentPwaState();
      return;
    }

    if (!isServiceWorkerSupported()) {
      this.offlineStatus = "unsupported";
      return;
    }

    window.addEventListener("beforeinstallprompt", this.handleBeforeInstallPrompt as EventListener);
    window.addEventListener("appinstalled", this.handleAppInstalled);
    navigator.serviceWorker.addEventListener("message", this.handleServiceWorkerMessage);
    navigator.serviceWorker.addEventListener("controllerchange", this.handleControllerChange);

    if (navigator.serviceWorker.controller !== null && this.offlinePreference !== "declined") {
      this.offlinePreference = "accepted";
      this.persistPreference();
      this.offlineStatus = "enabled";
    }

    if (this.offlinePreference === "accepted") {
      if (navigator.serviceWorker.controller !== null) {
        void this.attachExistingServiceWorker();
      } else {
        void this.registerServiceWorker();
      }
    }
  }

  public dispose(): void {
    if (!this.initialized) {
      return;
    }

    this.initialized = false;
    window.removeEventListener("beforeinstallprompt", this.handleBeforeInstallPrompt as EventListener);
    window.removeEventListener("appinstalled", this.handleAppInstalled);

    if (isServiceWorkerSupported()) {
      navigator.serviceWorker.removeEventListener("message", this.handleServiceWorkerMessage);
      navigator.serviceWorker.removeEventListener("controllerchange", this.handleControllerChange);
    }

    this.removeRegistrationUpdateListener?.();
    this.removeRegistrationUpdateListener = null;
    this.stopUpdatePolling();
  }

  public declineOfflineMode(): void {
    if (this.offlinePreference !== "unknown") {
      return;
    }

    this.offlinePreference = "declined";
    this.offlineStatus = "not-enabled";
    this.persistPreference();
  }

  public async enableOfflineMode(): Promise<void> {
    if (!isRootPublicAssetBaseUrl() || !isServiceWorkerSupported()) {
      runInAction(() => {
        this.offlineStatus = "unsupported";
      });
      return;
    }

    runInAction(() => {
      this.errorMessage = null;
      this.offlinePreference = "accepted";
      this.offlineStatus = "registering";
      this.persistPreference();
    });

    await this.registerServiceWorker();
  }

  public async checkForUpdate(showNoUpdateResult = true): Promise<void> {
    if (!isServiceWorkerSupported() || this.offlinePreference !== "accepted") {
      return;
    }

    if (showNoUpdateResult) {
      runInAction(() => {
        this.errorMessage = null;
        this.offlineStatus = "checking-update";
      });
    }

    if (this.registration === null) {
      await this.registerServiceWorker();

      const registeredServiceWorker = this.registration;

      if (showNoUpdateResult && registeredServiceWorker !== null) {
        runInAction(() => {
          this.resolveCheckedRegistrationState(registeredServiceWorker);
        });
      }

      return;
    }

    try {
      const registration = await this.registration.update();

      if (showNoUpdateResult) {
        runInAction(() => {
          this.resolveCheckedRegistrationState(registration);
        });
      }
    } catch (error) {
      runInAction(() => {
        this.errorMessage = error instanceof Error ? error.message : "Service worker update failed";
        this.offlineStatus = "error";
      });
    }
  }

  public applyWaitingUpdate(): void {
    const waitingWorker = this.waitingWorker ?? this.registration?.waiting ?? null;

    if (waitingWorker === null) {
      return;
    }

    this.reloadAfterControllerChange = true;
    this.offlineStatus = "updating";
    waitingWorker.postMessage({ type: "PWA_SKIP_WAITING" });
  }

  public async promptDesktopInstall(): Promise<void> {
    const promptEvent = this.beforeInstallPromptEvent;

    if (promptEvent === null || this.standalone) {
      return;
    }

    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;

    runInAction(() => {
      this.beforeInstallPromptEvent = null;
      this.installPromptAvailable = false;

      if (choice.outcome === "dismissed") {
        this.desktopInstallPromptDismissed = true;
        this.persistPreference();
      }
    });
  }

  public dismissDesktopInstallPrompt(): void {
    this.desktopInstallPromptDismissed = true;
    this.persistPreference();
  }

  public resetDesktopInstallPromptDismissal(): void {
    this.desktopInstallPromptDismissed = false;
    this.persistPreference();
  }

  private async registerServiceWorker(): Promise<void> {
    try {
      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        type: "module",
        updateViaCache: "none",
      });

      runInAction(() => {
        this.registration = registration;
        this.bindRegistration(registration);
        this.startUpdatePolling();
        this.resolveRegistrationState(registration);
      });
    } catch (error) {
      runInAction(() => {
        this.errorMessage = error instanceof Error ? error.message : "Service worker registration failed";
        this.offlineStatus = "error";
      });
    }
  }

  private async attachExistingServiceWorker(): Promise<void> {
    try {
      const existingRegistration = await navigator.serviceWorker.getRegistration();

      if (existingRegistration === undefined) {
        // 竞态：controller 存在但 getRegistration 返回空，回退到 register
        await this.registerServiceWorker();
        return;
      }

      runInAction(() => {
        this.registration = existingRegistration;
        this.bindRegistration(existingRegistration);
        this.startUpdatePolling();
        this.resolveRegistrationState(existingRegistration);
      });
    } catch {
      // getRegistration 异常时回退到 register
      await this.registerServiceWorker();
    }
  }

  private bindRegistration(registration: ServiceWorkerRegistration): void {
    this.removeRegistrationUpdateListener?.();

    const handleUpdateFound = () => {
      const installingWorker = registration.installing;

      if (installingWorker !== null) {
        this.trackInstallingWorker(installingWorker);
      }
    };

    registration.addEventListener("updatefound", handleUpdateFound);
    this.removeRegistrationUpdateListener = () => {
      registration.removeEventListener("updatefound", handleUpdateFound);
    };

    if (registration.installing !== null) {
      this.trackInstallingWorker(registration.installing);
    }
  }

  private trackInstallingWorker(worker: ServiceWorker): void {
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed") {
        runInAction(() => {
          if (navigator.serviceWorker.controller !== null) {
            this.waitingWorker = worker;
            this.offlineStatus = "update-available";
            return;
          }

          this.offlineStatus = "enabled";
          this.progress = null;
        });
      }

      if (worker.state === "redundant") {
        runInAction(() => {
          if (this.offlineStatus === "installing" || this.offlineStatus === "updating") {
            this.offlineStatus = "error";
            this.errorMessage = "Service worker install became redundant";
          }
        });
      }
    });
  }

  private resolveRegistrationState(registration: ServiceWorkerRegistration): void {
    if (registration.waiting !== null && navigator.serviceWorker.controller !== null) {
      this.waitingWorker = registration.waiting;
      this.offlineStatus = "update-available";
      return;
    }

    if (registration.installing !== null) {
      this.offlineStatus = navigator.serviceWorker.controller === null ? "installing" : "updating";
      return;
    }

    if (registration.active !== null) {
      this.offlineStatus = "enabled";
      this.progress = null;
      return;
    }

    this.offlineStatus = "registering";
  }

  private resolveCheckedRegistrationState(registration: ServiceWorkerRegistration): void {
    if (registration.waiting !== null && navigator.serviceWorker.controller !== null) {
      this.waitingWorker = registration.waiting;
      this.offlineStatus = "update-available";
      return;
    }

    if (registration.installing !== null) {
      this.offlineStatus = navigator.serviceWorker.controller === null ? "installing" : "updating";
      return;
    }

    if (registration.active !== null) {
      this.offlineStatus = "up-to-date";
      this.progress = null;
      return;
    }

    this.offlineStatus = "registering";
  }

  private startUpdatePolling(): void {
    if (this.pollIntervalId !== null) {
      return;
    }

    this.pollIntervalId = window.setInterval(() => {
      void this.checkForUpdate(false);
    }, UPDATE_POLL_INTERVAL_MS);
  }

  private stopUpdatePolling(): void {
    if (this.pollIntervalId === null) {
      return;
    }

    window.clearInterval(this.pollIntervalId);
    this.pollIntervalId = null;
  }

  private handleBeforeInstallPrompt(event: Event): void {
    event.preventDefault();

    this.beforeInstallPromptEvent = event as BeforeInstallPromptEvent;
    this.installPromptAvailable = true;
  }

  private handleAppInstalled(): void {
    this.beforeInstallPromptEvent = null;
    this.installPromptAvailable = false;
    this.desktopInstallPromptDismissed = true;
    this.standalone = true;
    this.persistPreference();
  }

  private handleControllerChange(): void {
    if (this.reloadAfterControllerChange) {
      window.location.reload();
      return;
    }

    this.offlineStatus = "enabled";
    this.progress = null;
  }

  private handleServiceWorkerMessage(event: MessageEvent<unknown>): void {
    const message = parseServiceWorkerMessage(event.data);

    if (message === null) {
      return;
    }

    if (message.type === "PWA_PRECACHE_PROGRESS") {
      this.progress = {
        cacheName: message.cacheName,
        completedBytes: message.completedBytes,
        completedFiles: message.completedFiles,
        currentUrl: message.currentUrl,
        totalBytes: message.totalBytes,
        totalFiles: message.totalFiles,
      };
      this.offlineStatus = navigator.serviceWorker.controller === null ? "installing" : "updating";
      return;
    }

    if (message.type === "PWA_PRECACHE_DONE") {
      this.progress = {
        cacheName: message.cacheName,
        completedBytes: message.totalBytes,
        completedFiles: message.totalFiles,
        currentUrl: null,
        totalBytes: message.totalBytes,
        totalFiles: message.totalFiles,
      };

      if (navigator.serviceWorker.controller !== null) {
        this.offlineStatus = "update-available";
        this.waitingWorker = this.registration?.waiting ?? this.waitingWorker;
        return;
      }

      this.offlineStatus = "enabled";
      this.progress = null;
      return;
    }

    if (message.type === "PWA_PRECACHE_ERROR") {
      this.errorMessage = message.message;
      this.offlineStatus = "error";
      return;
    }

    this.offlineStatus = "enabled";
    this.progress = null;
  }

  private persistPreference(): void {
    saveToLocalStorage<PersistedPwaPreference>(PWA_PREFERENCE_LOCAL_STORAGE_KEY, {
      desktopInstallPromptDismissed: this.desktopInstallPromptDismissed,
      offlineMode: this.offlinePreference,
    });
  }
}

export function formatPwaBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"] as const;
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const maximumFractionDigits = unitIndex === 0 ? 0 : 1;

  return `${value.toFixed(maximumFractionDigits)} ${units[unitIndex]}`;
}

function isServiceWorkerSupported(): boolean {
  return !isPwaDevelopmentServer()
    && isServiceWorkerRuntimeSupported();
}

function isServiceWorkerRuntimeSupported(): boolean {
  return typeof window !== "undefined"
    && typeof navigator !== "undefined"
    && "serviceWorker" in navigator;
}

function isPwaDevelopmentServer(): boolean {
  return import.meta.env.DEV;
}

async function cleanupDevelopmentPwaState(): Promise<void> {
  if (!isServiceWorkerRuntimeSupported()) {
    return;
  }

  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));

  if (typeof caches === "undefined") {
    return;
  }

  const cacheNames = await caches.keys();
  await Promise.all(
    cacheNames
      .filter((cacheName) => cacheName.startsWith("industrial-planner-precache-"))
      .map((cacheName) => caches.delete(cacheName)),
  );
}

function resolveStandaloneMode(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const navigatorWithStandalone = navigator as Navigator & { readonly standalone?: boolean };

  return navigatorWithStandalone.standalone === true
    || (
      typeof window.matchMedia === "function"
      && window.matchMedia("(display-mode: standalone)").matches
    );
}

function normalizePersistedPwaPreference(value: unknown): Required<PersistedPwaPreference> {
  if (!isRecord(value)) {
    return {
      desktopInstallPromptDismissed: false,
      offlineMode: "unknown",
    };
  }

  const offlineMode = value.offlineMode === "accepted" || value.offlineMode === "declined"
    ? value.offlineMode
    : "unknown";

  return {
    desktopInstallPromptDismissed: value.desktopInstallPromptDismissed === true,
    offlineMode,
  };
}

function parseServiceWorkerMessage(value: unknown): PwaServiceWorkerMessage | null {
  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }

  if (value.type === "PWA_PRECACHE_PROGRESS"
    && typeof value.cacheName === "string"
    && typeof value.completedBytes === "number"
    && typeof value.completedFiles === "number"
    && typeof value.currentUrl === "string"
    && typeof value.totalBytes === "number"
    && typeof value.totalFiles === "number") {
    return value as PwaServiceWorkerMessage;
  }

  if (value.type === "PWA_PRECACHE_DONE"
    && typeof value.cacheName === "string"
    && typeof value.totalBytes === "number"
    && typeof value.totalFiles === "number") {
    return value as PwaServiceWorkerMessage;
  }

  if (value.type === "PWA_PRECACHE_ERROR"
    && typeof value.cacheName === "string"
    && typeof value.message === "string") {
    return value as PwaServiceWorkerMessage;
  }

  if (value.type === "PWA_ACTIVATED" && typeof value.cacheName === "string") {
    return value as PwaServiceWorkerMessage;
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
