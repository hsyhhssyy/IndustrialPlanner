import { makeAutoObservable, runInAction } from "mobx";

import { isRootPublicAssetBaseUrl } from "@/shared/browser/public-asset-url";
import { readFromLocalStorage, saveToLocalStorage } from "@/shared/storage";

const PWA_PREFERENCE_LOCAL_STORAGE_KEY = "industrial-planner-pwa-preference";
const UPDATE_POLL_INTERVAL_MS = 15 * 60 * 1000;

export type PwaOfflinePreference = "unknown" | "accepted" | "declined";

export type PwaFullscreenNotice =
  | "apple-mobile-install"
  | "request-rejected"
  | "unsupported";

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
  readonly task: PwaProgressTask;
  readonly totalBytes: number;
  readonly totalFiles: number;
}

export type PwaProgressTask = "animation" | "core";

export type PwaDeviceAnimationStatus =
  | "idle"
  | "checking-update"
  | "downloading"
  | "complete"
  | "preempted-by-update"
  | "error";

export interface PwaDeviceAnimationSettingBinding {
  readonly readEnabled: () => boolean;
  readonly writeEnabled: (value: boolean) => void;
}

interface PersistedPwaPreference {
  readonly desktopInstallPromptDismissed?: boolean;
  readonly deviceAnimationsRequested?: boolean;
  readonly offlineMode?: PwaOfflinePreference;
}

interface NormalizedPwaPreference {
  readonly desktopInstallPromptDismissed: boolean;
  readonly deviceAnimationsRequested: boolean | null;
  readonly offlineMode: PwaOfflinePreference;
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
    readonly task: PwaProgressTask;
    readonly totalBytes: number;
    readonly totalFiles: number;
  }
  | {
    readonly type: "PWA_PRECACHE_DONE";
    readonly cacheName: string;
    readonly task: PwaProgressTask;
    readonly totalBytes: number;
    readonly totalFiles: number;
  }
  | {
    readonly type: "PWA_PRECACHE_ERROR";
    readonly cacheName: string;
    readonly message: string;
    readonly task: PwaProgressTask;
  }
  | {
    readonly type: "PWA_ANIMATION_CACHE_CANCELLED";
    readonly cacheName: string;
  }
  | {
    readonly type: "PWA_ANIMATION_CACHE_INVALIDATED";
    readonly cacheName: string;
  }
  | {
    readonly type: "PWA_ACTIVATED";
    readonly cacheName: string;
  };

export class PwaController {
  public deviceAnimationErrorMessage: string | null = null;
  public deviceAnimationStatus: PwaDeviceAnimationStatus = "idle";
  public deviceAnimationsRequested = false;
  public desktopInstallPromptDismissed = false;
  public errorMessage: string | null = null;
  public fullscreenNotice: PwaFullscreenNotice | null = null;
  public installPromptAvailable = false;
  public offlinePreference: PwaOfflinePreference = "unknown";
  public offlineStatus: PwaOfflineStatus = "ready-to-enable";
  public progress: PwaProgress | null = null;
  public standalone = false;

  private beforeInstallPromptEvent: BeforeInstallPromptEvent | null = null;
  private deviceAnimationOperationId = 0;
  private readonly deviceAnimationSettingBinding: PwaDeviceAnimationSettingBinding | null;
  private initialized = false;
  private pollIntervalId: number | null = null;
  private registration: ServiceWorkerRegistration | null = null;
  private removeRegistrationUpdateListener: (() => void) | null = null;
  private reloadAfterControllerChange = false;
  private waitingWorker: ServiceWorker | null = null;

  public constructor(deviceAnimationSettingBinding: PwaDeviceAnimationSettingBinding | null = null) {
    const persistedPreference = normalizePersistedPwaPreference(
      readFromLocalStorage<unknown>(PWA_PREFERENCE_LOCAL_STORAGE_KEY),
    );
    this.desktopInstallPromptDismissed = persistedPreference.desktopInstallPromptDismissed;
    this.deviceAnimationSettingBinding = deviceAnimationSettingBinding;
    this.deviceAnimationsRequested = persistedPreference.deviceAnimationsRequested
      ?? deviceAnimationSettingBinding?.readEnabled()
      ?? false;
    this.offlinePreference = persistedPreference.offlineMode;
    this.offlineStatus = this.offlinePreference === "declined" ? "not-enabled" : "ready-to-enable";
    this.standalone = resolveStandaloneMode();

    if (this.shouldGateDeviceAnimations) {
      this.writeDeviceAnimationsEnabled(false);
    }

    makeAutoObservable<
      PwaController,
      | "beforeInstallPromptEvent"
      | "deviceAnimationOperationId"
      | "deviceAnimationSettingBinding"
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
        deviceAnimationOperationId: false,
        deviceAnimationSettingBinding: false,
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

  public get deviceAnimationsSettingValue(): boolean {
    if (this.shouldGateDeviceAnimations) {
      return this.deviceAnimationsRequested;
    }

    return this.deviceAnimationSettingBinding?.readEnabled()
      ?? this.deviceAnimationsRequested;
  }

  private get shouldGateDeviceAnimations(): boolean {
    return this.isOfflineModeAccepted
      && isRootPublicAssetBaseUrl()
      && isServiceWorkerSupported();
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
      this.writeDeviceAnimationsEnabled(this.deviceAnimationsRequested);
      return;
    }

    if (isPwaDevelopmentServer()) {
      this.offlineStatus = "unsupported";
      this.writeDeviceAnimationsEnabled(this.deviceAnimationsRequested);
      void cleanupDevelopmentPwaState();
      return;
    }

    if (!isServiceWorkerSupported()) {
      this.offlineStatus = "unsupported";
      this.writeDeviceAnimationsEnabled(this.deviceAnimationsRequested);
      return;
    }

    window.addEventListener("beforeinstallprompt", this.handleBeforeInstallPrompt as EventListener);
    window.addEventListener("appinstalled", this.handleAppInstalled);
    window.addEventListener("online", this.handleOnline);
    window.addEventListener("storage", this.handlePreferenceStorage);
    navigator.serviceWorker.addEventListener("message", this.handleServiceWorkerMessage);
    navigator.serviceWorker.addEventListener("controllerchange", this.handleControllerChange);

    if (navigator.serviceWorker.controller !== null && this.offlinePreference !== "declined") {
      const shouldCaptureOnlineSetting = this.offlinePreference !== "accepted";
      this.offlinePreference = "accepted";

      if (shouldCaptureOnlineSetting) {
        this.deviceAnimationsRequested = this.deviceAnimationSettingBinding?.readEnabled()
          ?? this.deviceAnimationsRequested;
      }

      this.writeDeviceAnimationsEnabled(false);
      this.persistPreference();
      this.offlineStatus = "enabled";
    }

    if (this.offlinePreference === "accepted") {
      void this.initializeAcceptedOfflineMode();
    }
  }

  public dispose(): void {
    if (!this.initialized) {
      return;
    }

    this.initialized = false;
    window.removeEventListener("beforeinstallprompt", this.handleBeforeInstallPrompt as EventListener);
    window.removeEventListener("appinstalled", this.handleAppInstalled);
    window.removeEventListener("online", this.handleOnline);
    window.removeEventListener("storage", this.handlePreferenceStorage);

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
      this.deviceAnimationsRequested = this.deviceAnimationSettingBinding?.readEnabled()
        ?? this.deviceAnimationsRequested;
      this.writeDeviceAnimationsEnabled(false);
      this.offlinePreference = "accepted";
      this.offlineStatus = "registering";
      this.persistPreference();
    });

    await this.registerServiceWorker();

    if (this.deviceAnimationsRequested) {
      await this.prepareDeviceAnimationDownload();
    }
  }

  public setDeviceAnimationsEnabled(value: boolean): void {
    this.applyDeviceAnimationsRequested(value, true);
  }

  public retryDeviceAnimationDownload(): void {
    if (!this.isOfflineModeAccepted || !this.deviceAnimationsRequested) {
      return;
    }

    void this.prepareDeviceAnimationDownload();
  }

  public async checkForUpdate(showNoUpdateResult = true): Promise<boolean> {
    if (!isServiceWorkerSupported() || this.offlinePreference !== "accepted") {
      return false;
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

      return registeredServiceWorker !== null && !hasPendingServiceWorkerUpdate(registeredServiceWorker);
    }

    try {
      const registration = await this.registration.update();

      if (showNoUpdateResult) {
        runInAction(() => {
          this.resolveCheckedRegistrationState(registration);
        });
      }

      return !hasPendingServiceWorkerUpdate(registration);
    } catch (error) {
      if (showNoUpdateResult) {
        runInAction(() => {
          this.errorMessage = error instanceof Error ? error.message : "Service worker update failed";
          this.offlineStatus = "error";
        });
      }

      return false;
    }
  }

  public applyWaitingUpdate(): void {
    const waitingWorker = this.waitingWorker ?? this.registration?.waiting ?? null;

    if (waitingWorker === null) {
      return;
    }

    this.preemptDeviceAnimationForUpdate();
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

  public openFullscreenNotice(reason: "rejected" | "unsupported"): void {
    if (reason === "rejected") {
      this.fullscreenNotice = "request-rejected";
      return;
    }

    this.fullscreenNotice = isAppleMobileBrowser()
      ? "apple-mobile-install"
      : "unsupported";
  }

  public closeFullscreenNotice(): void {
    this.fullscreenNotice = null;
  }

  public resetDesktopInstallPromptDismissal(): void {
    this.desktopInstallPromptDismissed = false;
    this.persistPreference();
  }

  private async initializeAcceptedOfflineMode(): Promise<void> {
    await this.registerServiceWorker();

    if (this.deviceAnimationsRequested) {
      await this.prepareDeviceAnimationDownload();
    }
  }

  private applyDeviceAnimationsRequested(value: boolean, persist: boolean): void {
    this.deviceAnimationOperationId += 1;
    this.deviceAnimationsRequested = value;
    this.deviceAnimationErrorMessage = null;

    if (persist) {
      this.persistPreference();
    }

    if (!this.shouldGateDeviceAnimations) {
      this.deviceAnimationStatus = value ? "complete" : "idle";
      this.progress = this.progress?.task === "animation" ? null : this.progress;
      this.writeDeviceAnimationsEnabled(value);
      return;
    }

    this.writeDeviceAnimationsEnabled(false);

    if (!value) {
      this.deviceAnimationStatus = "idle";
      this.progress = this.progress?.task === "animation" ? null : this.progress;
      this.postMessageToActiveServiceWorker({ type: "PWA_ANIMATION_CACHE_CANCEL" });
      return;
    }

    void this.prepareDeviceAnimationDownload();
  }

  private async prepareDeviceAnimationDownload(): Promise<void> {
    if (!this.shouldGateDeviceAnimations || !this.deviceAnimationsRequested) {
      return;
    }

    const operationId = this.deviceAnimationOperationId + 1;
    this.deviceAnimationOperationId = operationId;
    this.deviceAnimationErrorMessage = null;
    this.deviceAnimationStatus = "checking-update";
    this.progress = this.progress?.task === "animation" ? null : this.progress;
    this.writeDeviceAnimationsEnabled(false);

    if (this.registration === null) {
      await this.registerServiceWorker();
    }

    if (!this.isCurrentDeviceAnimationOperation(operationId)) {
      return;
    }

    const currentVersionConfirmed = await this.checkForUpdate(false);

    if (!this.isCurrentDeviceAnimationOperation(operationId)) {
      return;
    }

    const registration = this.registration;
    if (!currentVersionConfirmed
      || registration === null
      || hasPendingServiceWorkerUpdate(registration)
      || this.offlineStatus === "error") {
      this.deviceAnimationStatus = "preempted-by-update";
      return;
    }

    const messageSent = this.postMessageToActiveServiceWorker({
      type: "PWA_ANIMATION_CACHE_START",
    });

    this.deviceAnimationStatus = messageSent ? "downloading" : "idle";
  }

  private isCurrentDeviceAnimationOperation(operationId: number): boolean {
    return this.deviceAnimationOperationId === operationId
      && this.isOfflineModeAccepted
      && this.shouldGateDeviceAnimations
      && this.deviceAnimationsRequested;
  }

  private preemptDeviceAnimationForUpdate(): void {
    if (!this.shouldGateDeviceAnimations) {
      return;
    }

    this.deviceAnimationOperationId += 1;
    this.writeDeviceAnimationsEnabled(false);
    this.progress = this.progress?.task === "animation" ? null : this.progress;
    this.deviceAnimationStatus = this.deviceAnimationsRequested
      ? "preempted-by-update"
      : "idle";
    this.postMessageToActiveServiceWorker({ type: "PWA_ANIMATION_CACHE_CANCEL" });
  }

  private writeDeviceAnimationsEnabled(value: boolean): void {
    if (this.deviceAnimationSettingBinding === null
      || this.deviceAnimationSettingBinding.readEnabled() === value) {
      return;
    }

    this.deviceAnimationSettingBinding.writeEnabled(value);
  }

  private postMessageToActiveServiceWorker(message: {
    readonly type: "PWA_ANIMATION_CACHE_CANCEL" | "PWA_ANIMATION_CACHE_START";
  }): boolean {
    if (!isServiceWorkerRuntimeSupported()) {
      return false;
    }

    const worker = navigator.serviceWorker.controller
      ?? this.registration?.active
      ?? null;

    if (worker === null) {
      return false;
    }

    worker.postMessage(message);
    return true;
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

  private bindRegistration(registration: ServiceWorkerRegistration): void {
    this.removeRegistrationUpdateListener?.();

    const handleUpdateFound = () => {
      const installingWorker = registration.installing;

      if (installingWorker !== null) {
        this.preemptDeviceAnimationForUpdate();
        this.trackInstallingWorker(installingWorker);
      }
    };

    registration.addEventListener("updatefound", handleUpdateFound);
    this.removeRegistrationUpdateListener = () => {
      registration.removeEventListener("updatefound", handleUpdateFound);
    };

    if (registration.installing !== null) {
      this.preemptDeviceAnimationForUpdate();
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
      this.preemptDeviceAnimationForUpdate();
      this.waitingWorker = registration.waiting;
      this.offlineStatus = "update-available";
      return;
    }

    if (registration.installing !== null) {
      this.preemptDeviceAnimationForUpdate();
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
      this.preemptDeviceAnimationForUpdate();
      this.waitingWorker = registration.waiting;
      this.offlineStatus = "update-available";
      return;
    }

    if (registration.installing !== null) {
      this.preemptDeviceAnimationForUpdate();
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

  private handleOnline(): void {
    if (!this.deviceAnimationsRequested
      || !this.shouldGateDeviceAnimations
      || this.deviceAnimationStatus === "complete"
      || this.deviceAnimationStatus === "downloading"
      || hasBlockingPwaStatus(this.offlineStatus)) {
      return;
    }

    void this.prepareDeviceAnimationDownload();
  }

  private handleControllerChange(): void {
    if (this.reloadAfterControllerChange) {
      window.location.reload();
      return;
    }

    // 非用户主动点击"更新"触发的 SW 接管（如 Chrome 后台自动激活等待中的 SW）。
    // 此时页面资源版本与 SW 版本可能不一致，刷新页面以确保一致性。
    // 使用 sessionStorage 防止刷新死循环。
    const RELOAD_GUARD_KEY = "__pwa_controller_change_reload__";
    if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(RELOAD_GUARD_KEY) === "1") {
      sessionStorage.removeItem(RELOAD_GUARD_KEY);
      this.offlineStatus = "enabled";
      this.progress = null;
      return;
    }

    try {
      sessionStorage.setItem(RELOAD_GUARD_KEY, "1");
    } catch {
      // sessionStorage 不可用（隐私模式等），回退到直接重置状态
      this.offlineStatus = "enabled";
      this.progress = null;
      return;
    }
    window.location.reload();
  }

  private handleServiceWorkerMessage(event: MessageEvent<unknown>): void {
    const message = parseServiceWorkerMessage(event.data);

    if (message === null) {
      return;
    }

    if (message.type === "PWA_PRECACHE_PROGRESS") {
      const nextProgress: PwaProgress = {
        cacheName: message.cacheName,
        completedBytes: message.completedBytes,
        completedFiles: message.completedFiles,
        currentUrl: message.currentUrl,
        task: message.task,
        totalBytes: message.totalBytes,
        totalFiles: message.totalFiles,
      };

      if (message.task === "animation") {
        if (!this.deviceAnimationsRequested || !this.shouldGateDeviceAnimations) {
          this.postMessageToActiveServiceWorker({ type: "PWA_ANIMATION_CACHE_CANCEL" });
          return;
        }

        if (hasBlockingPwaStatus(this.offlineStatus)) {
          this.preemptDeviceAnimationForUpdate();
          return;
        }

        this.progress = nextProgress;
        this.deviceAnimationStatus = "downloading";
        this.writeDeviceAnimationsEnabled(false);
        return;
      }

      this.progress = nextProgress;
      this.preemptDeviceAnimationForUpdate();
      this.offlineStatus = navigator.serviceWorker.controller === null ? "installing" : "updating";
      return;
    }

    if (message.type === "PWA_PRECACHE_DONE") {
      const nextProgress: PwaProgress = {
        cacheName: message.cacheName,
        completedBytes: message.totalBytes,
        completedFiles: message.totalFiles,
        currentUrl: null,
        task: message.task,
        totalBytes: message.totalBytes,
        totalFiles: message.totalFiles,
      };

      if (message.task === "animation") {
        this.progress = this.progress?.task === "animation" ? null : this.progress;

        if (this.deviceAnimationsRequested
          && this.shouldGateDeviceAnimations
          && !hasBlockingPwaStatus(this.offlineStatus)) {
          this.deviceAnimationStatus = "complete";
          this.deviceAnimationErrorMessage = null;
          this.writeDeviceAnimationsEnabled(true);
        } else {
          this.writeDeviceAnimationsEnabled(false);
        }

        return;
      }

      this.progress = nextProgress;
      if (navigator.serviceWorker.controller !== null) {
        this.preemptDeviceAnimationForUpdate();
        this.offlineStatus = "update-available";
        this.waitingWorker = this.registration?.waiting ?? this.waitingWorker;
        return;
      }

      this.offlineStatus = "enabled";
      this.progress = null;
      return;
    }

    if (message.type === "PWA_PRECACHE_ERROR") {
      if (message.task === "animation") {
        this.progress = this.progress?.task === "animation" ? null : this.progress;
        this.deviceAnimationErrorMessage = message.message;
        this.deviceAnimationStatus = "error";
        this.writeDeviceAnimationsEnabled(false);
        return;
      }

      this.preemptDeviceAnimationForUpdate();
      this.errorMessage = message.message;
      this.offlineStatus = "error";
      return;
    }

    if (message.type === "PWA_ANIMATION_CACHE_CANCELLED") {
      if (!this.deviceAnimationsRequested) {
        this.deviceAnimationStatus = "idle";
      }

      return;
    }

    if (message.type === "PWA_ANIMATION_CACHE_INVALIDATED") {
      this.deviceAnimationStatus = "idle";
      this.writeDeviceAnimationsEnabled(false);

      if (this.deviceAnimationsRequested && this.shouldGateDeviceAnimations) {
        void this.prepareDeviceAnimationDownload();
      }

      return;
    }

    this.offlineStatus = "enabled";
    this.progress = this.progress?.task === "core" ? null : this.progress;
  }

  private handlePreferenceStorage(event: StorageEvent): void {
    if (event.key !== PWA_PREFERENCE_LOCAL_STORAGE_KEY || event.newValue === null) {
      return;
    }

    let parsedValue: unknown;

    try {
      parsedValue = JSON.parse(event.newValue);
    } catch {
      return;
    }

    const preference = normalizePersistedPwaPreference(parsedValue);

    if (preference.deviceAnimationsRequested === null
      || preference.deviceAnimationsRequested === this.deviceAnimationsRequested) {
      return;
    }

    this.applyDeviceAnimationsRequested(preference.deviceAnimationsRequested, false);
  }

  private persistPreference(): void {
    saveToLocalStorage<PersistedPwaPreference>(PWA_PREFERENCE_LOCAL_STORAGE_KEY, {
      desktopInstallPromptDismissed: this.desktopInstallPromptDismissed,
      deviceAnimationsRequested: this.deviceAnimationsRequested,
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
      .filter((cacheName) =>
        cacheName.startsWith("industrial-planner-precache-")
        || cacheName.startsWith("industrial-planner-animation-precache-")
      )
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

function isAppleMobileBrowser(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }

  return /iPhone|iPod/i.test(navigator.userAgent);
}

function normalizePersistedPwaPreference(value: unknown): NormalizedPwaPreference {
  if (!isRecord(value)) {
    return {
      desktopInstallPromptDismissed: false,
      deviceAnimationsRequested: null,
      offlineMode: "unknown",
    };
  }

  const offlineMode = value.offlineMode === "accepted" || value.offlineMode === "declined"
    ? value.offlineMode
    : "unknown";

  return {
    desktopInstallPromptDismissed: value.desktopInstallPromptDismissed === true,
    deviceAnimationsRequested: typeof value.deviceAnimationsRequested === "boolean"
      ? value.deviceAnimationsRequested
      : null,
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
    && (value.task === "animation" || value.task === "core")
    && typeof value.totalBytes === "number"
    && typeof value.totalFiles === "number") {
    return value as PwaServiceWorkerMessage;
  }

  if (value.type === "PWA_PRECACHE_DONE"
    && typeof value.cacheName === "string"
    && (value.task === "animation" || value.task === "core")
    && typeof value.totalBytes === "number"
    && typeof value.totalFiles === "number") {
    return value as PwaServiceWorkerMessage;
  }

  if (value.type === "PWA_PRECACHE_ERROR"
    && typeof value.cacheName === "string"
    && typeof value.message === "string"
    && (value.task === "animation" || value.task === "core")) {
    return value as PwaServiceWorkerMessage;
  }

  if (value.type === "PWA_ACTIVATED" && typeof value.cacheName === "string") {
    return value as PwaServiceWorkerMessage;
  }

  if ((value.type === "PWA_ANIMATION_CACHE_CANCELLED"
    || value.type === "PWA_ANIMATION_CACHE_INVALIDATED")
    && typeof value.cacheName === "string") {
    return value as PwaServiceWorkerMessage;
  }

  return null;
}

function hasPendingServiceWorkerUpdate(registration: ServiceWorkerRegistration): boolean {
  return registration.installing !== null
    || (registration.waiting !== null && navigator.serviceWorker.controller !== null);
}

function hasBlockingPwaStatus(status: PwaOfflineStatus): boolean {
  return status === "registering"
    || status === "installing"
    || status === "update-available"
    || status === "updating"
    || status === "error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
