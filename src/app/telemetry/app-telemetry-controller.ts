import type { ScreenProfile } from "@/domain/app";
import {
  attachWorkerRuntime,
  type WorkerRuntimeAttachment,
} from "@/shared/worker/attach-worker-runtime";
import {
  BUILD_BACKEND_API_BASE_URL,
  DEFAULT_BACKEND_API_BASE_URL,
  normalizeBackendApiBaseUrl,
} from "@/shared/storage/backend-api-address";
import { readCloudflareOAuthSession } from "@/shared/storage/cloudflare-oauth-session";
import {
  CLIENT_TELEMETRY_INTERVAL_MS,
  type ClientHeartbeatTelemetryPayload,
  type ClientTelemetryUploadPayload,
  type ClientTelemetryUserIdentityKind,
  type ClientTelemetryWorkerRequest,
} from "@/shared/storage/client-telemetry-protocol";
import { createSha256Hash } from "@/shared/storage/hash-utils";
import { ensureLocalSyncOwnerState } from "@/shared/storage/sync-owner-storage";

export interface AppTelemetryController {
  dispose(): void;
}

export interface AppTelemetryUserIdentity {
  readonly kind: ClientTelemetryUserIdentityKind;
  readonly code: string;
}

export interface AppTelemetryTransport {
  upload(payload: ClientTelemetryUploadPayload): void;
  dispose(): void;
}

export interface CreateAppTelemetryControllerOptions {
  readonly readScreenProfile: () => ScreenProfile;
  readonly enabled?: boolean;
  readonly intervalMs?: number;
  readonly resolveUserIdentity?: () => Promise<AppTelemetryUserIdentity>;
  readonly hashUserIdentity?: (identity: AppTelemetryUserIdentity) => Promise<string>;
  readonly readGameVersion?: () => string;
  readonly now?: () => string;
  readonly transportFactory?: () => AppTelemetryTransport;
}

export function createAppTelemetryController(
  options: CreateAppTelemetryControllerOptions,
): AppTelemetryController {
  const enabled = options.enabled ?? isLiveTelemetryBuild();
  if (!enabled) {
    return { dispose: () => undefined };
  }

  const intervalMs = normalizeIntervalMs(options.intervalMs);
  const resolveUserIdentity = options.resolveUserIdentity
    ?? resolveAppTelemetryUserIdentity;
  const hashUserIdentity = options.hashUserIdentity ?? hashAppTelemetryUserIdentity;
  const readGameVersion = options.readGameVersion ?? readCurrentGameVersion;
  const now = options.now ?? (() => new Date().toISOString());
  const transportFactory = options.transportFactory
    ?? createAppTelemetryWorkerTransport;
  let disposed = false;
  let timerId: ReturnType<typeof globalThis.setTimeout> | null = null;
  let transport: AppTelemetryTransport | null = null;

  const scheduleNextUpload = (): void => {
    if (disposed) {
      return;
    }

    try {
      timerId = globalThis.setTimeout(() => {
        void uploadAndReschedule();
      }, intervalMs);
      unrefTimer(timerId);
    } catch {
      timerId = null;
    }
  };

  const uploadAndReschedule = async (): Promise<void> => {
    if (disposed) {
      return;
    }

    try {
      const identity = await resolveUserIdentity();
      const identityHash = await hashUserIdentity(identity);
      if (disposed) {
        return;
      }

      const heartbeat = createClientHeartbeatTelemetryPayload({
        identity: {
          kind: identity.kind,
          code: identityHash,
        },
        gameVersion: readGameVersion(),
        screenProfile: options.readScreenProfile(),
        createdAt: now(),
      });
      const payload = createClientTelemetryUploadPayload(heartbeat);
      transport ??= transportFactory();
      transport.upload(payload);
    } catch {
      // 身份读取、版本读取、Screen Profile、Worker 创建和 postMessage 均不得影响主线程。
    } finally {
      scheduleNextUpload();
    }
  };

  void uploadAndReschedule();

  return {
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      if (timerId !== null) {
        globalThis.clearTimeout(timerId);
        timerId = null;
      }
      try {
        transport?.dispose();
      } catch {
        // 页面卸载不能被遥测清理失败阻断。
      }
      transport = null;
    },
  };
}

export function createClientHeartbeatTelemetryPayload(options: {
  readonly identity: AppTelemetryUserIdentity;
  readonly gameVersion: string;
  readonly screenProfile: ScreenProfile;
  readonly createdAt: string;
}): ClientHeartbeatTelemetryPayload {
  const profile = options.screenProfile;

  return {
    schemaVersion: 2,
    source: "industrial-planner",
    event: "client-heartbeat",
    createdAt: options.createdAt,
    userIdentityKind: options.identity.kind,
    userIdentityCode: options.identity.code,
    gameVersion: normalizeNonEmptyString(options.gameVersion, "unknown"),
    screenProfile: {
      viewportWidth: profile.viewportWidth,
      viewportHeight: profile.viewportHeight,
      devicePixelRatio: profile.devicePixelRatio,
      deviceClass: profile.deviceClass,
      screenShape: profile.screenShape,
      aspectRatio: profile.aspectRatio,
      hasTouch: profile.hasTouch,
    },
  };
}

export function createClientTelemetryUploadPayload(
  heartbeat: ClientHeartbeatTelemetryPayload,
): ClientTelemetryUploadPayload {
  return {
    schemaVersion: 1,
    installIdHash: heartbeat.userIdentityCode,
    trigger: "client-heartbeat",
    payload: heartbeat,
  };
}

export function isLiveTelemetryBuild(
  buildApiBaseUrl = BUILD_BACKEND_API_BASE_URL,
): boolean {
  return normalizeBackendApiBaseUrl(buildApiBaseUrl)
    === DEFAULT_BACKEND_API_BASE_URL;
}

export async function resolveAppTelemetryUserIdentity(): Promise<AppTelemetryUserIdentity> {
  const session = readCloudflareOAuthSession();
  if (
    session !== null
    && normalizeBackendApiBaseUrl(session.apiBaseUrl) === DEFAULT_BACKEND_API_BASE_URL
  ) {
    return {
      kind: "account",
      code: session.account.accountId,
    };
  }

  const ownerState = await ensureLocalSyncOwnerState();
  return {
    kind: "installation",
    code: ownerState.installId,
  };
}

export async function hashAppTelemetryUserIdentity(
  identity: AppTelemetryUserIdentity,
): Promise<string> {
  const bytes = new TextEncoder().encode(`${identity.kind}:${identity.code}`);
  const digest = await createSha256Hash(bytes);
  return digest.slice("sha256:".length, "sha256:".length + 32);
}

function createAppTelemetryWorkerTransport(): AppTelemetryTransport {
  let worker: Worker | null = null;
  let runtimeAttachment: WorkerRuntimeAttachment | null = null;
  let disposed = false;

  const destroyWorker = (): void => {
    const currentWorker = worker;
    worker = null;
    if (currentWorker !== null) {
      currentWorker.removeEventListener("error", handleWorkerError);
    }
    try {
      runtimeAttachment?.dispose();
    } catch {
      // Worker Runtime 清理失败不得传播。
    }
    runtimeAttachment = null;
    try {
      currentWorker?.terminate();
    } catch {
      // Worker 终止失败不得传播。
    }
  };

  const handleWorkerError = (event: ErrorEvent): void => {
    event.preventDefault();
    destroyWorker();
  };

  const ensureWorker = (): Worker | null => {
    if (disposed) {
      return null;
    }
    if (worker !== null) {
      return worker;
    }

    let candidate: Worker | null = null;
    try {
      candidate = new Worker(
        new URL("../../shared/storage/sync-telemetry-worker.ts", import.meta.url),
        { type: "module", name: "client-telemetry" },
      );
      candidate.addEventListener("error", handleWorkerError);
      runtimeAttachment = attachWorkerRuntime(candidate, "sync-telemetry", {
        onFault: destroyWorker,
      });
      worker = candidate;
      return worker;
    } catch {
      if (candidate !== null) {
        candidate.removeEventListener("error", handleWorkerError);
        try {
          candidate.terminate();
        } catch {
          // 创建失败后的清理同样保持静默。
        }
      }
      try {
        runtimeAttachment?.dispose();
      } catch {
        // 创建失败后的 Runtime 清理保持静默。
      }
      runtimeAttachment = null;
      worker = null;
      return null;
    }
  };

  return {
    upload(payload): void {
      const activeWorker = ensureWorker();
      if (activeWorker === null) {
        return;
      }

      const request: ClientTelemetryWorkerRequest = {
        type: "upload-telemetry",
        apiBaseUrl: DEFAULT_BACKEND_API_BASE_URL,
        payload,
      };
      try {
        activeWorker.postMessage(request);
      } catch {
        destroyWorker();
      }
    },
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      destroyWorker();
    },
  };
}

function readCurrentGameVersion(): string {
  const version = typeof window === "undefined"
    ? undefined
    : window.__APP_VERSION__;
  return normalizeNonEmptyString(version, "unknown");
}

function normalizeIntervalMs(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : CLIENT_TELEMETRY_INTERVAL_MS;
}

function normalizeNonEmptyString(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized === undefined || normalized === "" ? fallback : normalized;
}

function unrefTimer(timer: ReturnType<typeof globalThis.setTimeout>): void {
  const nodeTimer = timer as { readonly unref?: () => void };
  nodeTimer.unref?.();
}
