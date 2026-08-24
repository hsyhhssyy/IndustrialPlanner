import {
  deleteFromLocalStorage,
  readFromLocalStorage,
  trySaveToLocalStorage,
} from "./browser-storage";
import {
  normalizeBackendApiBaseUrl,
  resolveBackendApiBaseUrl,
} from "./backend-api-address";

export const CLOUDFLARE_OAUTH_SESSION_LOCAL_STORAGE_KEY =
  "v3-cloudflare-oauth-session";

export interface CloudflareOAuthSession {
  readonly schemaVersion: 1;
  readonly apiBaseUrl: string;
  readonly accessToken: string;
  readonly tokenType: "Bearer";
  readonly expiresAt: string;
  readonly account: {
    readonly accountId: string;
    readonly username: string;
  };
  readonly spaceId: string;
}

export type CloudflareOAuthSessionChangeListener = (
  session: CloudflareOAuthSession | null,
) => void;

export interface CompleteCloudflareOAuthLoginOptions {
  readonly apiBaseUrl?: string;
  readonly fetchImpl?: typeof fetch;
}

const sessionChangeListeners = new Set<CloudflareOAuthSessionChangeListener>();

export function readCloudflareOAuthSession(
  apiBaseUrl = resolveBackendApiBaseUrl(),
): CloudflareOAuthSession | null {
  const value = readFromLocalStorage<unknown>(
    CLOUDFLARE_OAUTH_SESSION_LOCAL_STORAGE_KEY,
  );
  const session = normalizeCloudflareOAuthSession(value, apiBaseUrl);
  if (value !== null && session === null) {
    deleteFromLocalStorage(CLOUDFLARE_OAUTH_SESSION_LOCAL_STORAGE_KEY);
  }
  return session;
}

export function writeCloudflareOAuthSession(
  value: CloudflareOAuthSession,
): CloudflareOAuthSession {
  const normalized = normalizeCloudflareOAuthSession(value, value.apiBaseUrl);
  if (normalized === null) {
    throw new Error("Cloudflare OAuth session is invalid or expired.");
  }
  if (!trySaveToLocalStorage(CLOUDFLARE_OAUTH_SESSION_LOCAL_STORAGE_KEY, normalized)) {
    throw new Error("Failed to persist Cloudflare OAuth session.");
  }
  emitCloudflareOAuthSessionChange(normalized);
  return normalized;
}

export function clearCloudflareOAuthSession(): void {
  deleteFromLocalStorage(CLOUDFLARE_OAUTH_SESSION_LOCAL_STORAGE_KEY);
  emitCloudflareOAuthSessionChange(null);
}

export function subscribeToCloudflareOAuthSessionChanges(
  listener: CloudflareOAuthSessionChangeListener,
): () => void {
  sessionChangeListeners.add(listener);
  const handleStorage = (event: StorageEvent) => {
    if (event.key === CLOUDFLARE_OAUTH_SESSION_LOCAL_STORAGE_KEY) {
      listener(readCloudflareOAuthSession());
    }
  };
  const handleFocus = () => {
    listener(readCloudflareOAuthSession());
  };
  globalThis.addEventListener?.("storage", handleStorage);
  globalThis.addEventListener?.("focus", handleFocus);

  return () => {
    sessionChangeListeners.delete(listener);
    globalThis.removeEventListener?.("storage", handleStorage);
    globalThis.removeEventListener?.("focus", handleFocus);
  };
}

// AI-REMOVED 2026-08-24:
// Reason: OAuth 浏览器握手已改由 cloudflare-oauth-browser-flow 统一携带前端 callback 与随机频道；session 模块只负责 token 交换和持久化。
// Trigger: 后端上线固定 Provider callback + frontend_redirect_uri + fragment code + BroadcastChannel ACK 协议，且用户明确要求不兼容未上线旧版。
// Evidence: 后端 OAuth 登录流程文档与 beta /v1/oauth/authorize 参数校验均确认新协议；旧入口缺少两个必填参数，旧 callback 转发也不再成立。
// Replacement: src/shared/storage/cloudflare-oauth-browser-flow.ts
// Risk: 旧前端产物无法再使用新版后端登录；该版本从未上线，无兼容要求。
// Human Review: Required
//
// Original code:
// export function createCloudflareOAuthAuthorizeUrl(
//   apiBaseUrl = resolveBackendApiBaseUrl(),
// ): string {
//   return `${normalizeBackendApiBaseUrl(apiBaseUrl)}/v1/oauth/authorize`;
// }
//
// export function createCloudflareOAuthBackendCallbackUrl(
//   browserCallbackUrl: string,
//   apiBaseUrl = resolveBackendApiBaseUrl(),
// ): string {
//   const source = new URL(browserCallbackUrl);
//   const target = new URL(
//     "/v1/oauth/callback",
//     `${normalizeBackendApiBaseUrl(apiBaseUrl)}/`,
//   );
//   target.search = source.search;
//   return target.href;
// }

export async function completeCloudflareOAuthLogin(
  callbackCode: string,
  options: CompleteCloudflareOAuthLoginOptions = {},
): Promise<CloudflareOAuthSession> {
  const code = callbackCode.trim();
  if (code === "") {
    throw new Error("OAuth callback code is missing.");
  }
  const apiBaseUrl = normalizeBackendApiBaseUrl(
    options.apiBaseUrl ?? resolveBackendApiBaseUrl(),
  );
  const fetchImpl = options.fetchImpl ?? fetch;
  const sessionResponse = await fetchImpl(`${apiBaseUrl}/v1/oauth/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const sessionBody = await readJsonRecord(sessionResponse);
  if (!sessionResponse.ok) {
    throw new Error(readApiErrorMessage(sessionBody, "OAuth session exchange failed."));
  }

  const accessToken = readNonEmptyString(sessionBody.accessToken);
  const tokenType = readNonEmptyString(sessionBody.tokenType);
  const expiresAt = readNonEmptyString(sessionBody.expiresAt);
  const account = isRecord(sessionBody.account) ? sessionBody.account : null;
  const accountId = readNonEmptyString(account?.accountId);
  const username = readNonEmptyString(account?.username);
  if (
    accessToken === null
    || tokenType !== "Bearer"
    || expiresAt === null
    || accountId === null
    || username === null
  ) {
    throw new Error("OAuth session response is invalid.");
  }

  const mineResponse = await fetchImpl(`${apiBaseUrl}/v1/sync/spaces/mine`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const mineBody = await readJsonRecord(mineResponse);
  if (!mineResponse.ok) {
    throw new Error(readApiErrorMessage(mineBody, "Cloudflare account space lookup failed."));
  }
  const spaceId = readNonEmptyString(mineBody.spaceId);
  if (spaceId === null) {
    throw new Error("Cloudflare account space response is invalid.");
  }

  return writeCloudflareOAuthSession({
    schemaVersion: 1,
    apiBaseUrl,
    accessToken,
    tokenType: "Bearer",
    expiresAt,
    account: { accountId, username },
    spaceId,
  });
}

function normalizeCloudflareOAuthSession(
  value: unknown,
  expectedApiBaseUrl: string,
): CloudflareOAuthSession | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.account)) {
    return null;
  }
  const apiBaseUrl = readNonEmptyString(value.apiBaseUrl);
  const accessToken = readNonEmptyString(value.accessToken);
  const expiresAt = readNonEmptyString(value.expiresAt);
  const accountId = readNonEmptyString(value.account.accountId);
  const username = readNonEmptyString(value.account.username);
  const spaceId = readNonEmptyString(value.spaceId);
  if (
    apiBaseUrl === null
    || accessToken === null
    || value.tokenType !== "Bearer"
    || expiresAt === null
    || accountId === null
    || username === null
    || spaceId === null
    || normalizeBackendApiBaseUrl(apiBaseUrl)
      !== normalizeBackendApiBaseUrl(expectedApiBaseUrl)
    || !Number.isFinite(Date.parse(expiresAt))
    || Date.parse(expiresAt) <= Date.now()
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    apiBaseUrl: normalizeBackendApiBaseUrl(apiBaseUrl),
    accessToken,
    tokenType: "Bearer",
    expiresAt,
    account: { accountId, username },
    spaceId,
  };
}

async function readJsonRecord(response: Response): Promise<Record<string, unknown>> {
  try {
    const value = await response.json() as unknown;
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

function readApiErrorMessage(
  value: Record<string, unknown>,
  fallback: string,
): string {
  return readNonEmptyString(value.message) ?? fallback;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

function emitCloudflareOAuthSessionChange(
  session: CloudflareOAuthSession | null,
): void {
  for (const listener of sessionChangeListeners) {
    try {
      listener(session);
    } catch {
      // 单个监听器失败不应影响登录信息写入或清理。
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
