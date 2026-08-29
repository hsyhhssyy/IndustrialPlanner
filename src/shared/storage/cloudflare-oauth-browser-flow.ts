import {
  normalizeBackendApiBaseUrl,
  resolveBackendApiBaseUrl,
} from "./backend-api-address";
import {
  completeCloudflareOAuthLogin,
  type CloudflareOAuthSession,
} from "./cloudflare-oauth-session";

export const CLOUDFLARE_OAUTH_CHANNEL_PREFIX = "industrial-planner:oauth:";
export const CLOUDFLARE_OAUTH_LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
export const CLOUDFLARE_OAUTH_CALLBACK_ACK_TIMEOUT_MS = 30 * 1000;
export const CLOUDFLARE_OAUTH_CALLBACK_RETRY_INTERVAL_MS = 500;

const CLOUDFLARE_OAUTH_MESSAGE_VERSION = 1;
const ALPHA_DEPLOYMENT_PATH_PATTERN = /^\/([0-9a-f]{40})(?:\/|$)/u;
const OAUTH_CHANNEL_PATTERN = /^[A-Za-z0-9_-]{22,128}$/u;
const MAX_CALLBACK_VALUE_LENGTH = 2_048;

export interface CloudflareOAuthResultMessage {
  readonly type: "cloudflare-oauth-result";
  readonly version: 1;
  readonly oauthChannel: string;
  readonly code?: string;
  readonly error?: string;
}

export interface CloudflareOAuthAckMessage {
  readonly type: "cloudflare-oauth-ack";
  readonly version: 1;
  readonly oauthChannel: string;
}

export type CloudflareOAuthLoginErrorCode =
  | "broadcast_channel_unavailable"
  | "popup_blocked"
  | "login_timeout"
  | "provider_error";

export class CloudflareOAuthLoginError extends Error {
  public constructor(
    public readonly code: CloudflareOAuthLoginErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CloudflareOAuthLoginError";
  }
}

export interface StartCloudflareOAuthLoginOptions {
  readonly apiBaseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly frontendRedirectUri?: string;
  readonly oauthChannel?: string;
  readonly timeoutMs?: number;
}

export function createCloudflareOAuthChannel(): string {
  const channel = globalThis.crypto.randomUUID();
  if (!isCloudflareOAuthChannel(channel)) {
    throw new Error("Generated OAuth channel is invalid.");
  }
  return channel;
}

export function isCloudflareOAuthChannel(value: unknown): value is string {
  return typeof value === "string" && OAUTH_CHANNEL_PATTERN.test(value);
}

export function createCloudflareOAuthBroadcastChannelName(
  oauthChannel: string,
): string {
  if (!isCloudflareOAuthChannel(oauthChannel)) {
    throw new Error("OAuth channel is invalid.");
  }
  return `${CLOUDFLARE_OAUTH_CHANNEL_PREFIX}${oauthChannel}`;
}

export function createCloudflareOAuthFrontendRedirectUri(
  browserUrl = globalThis.location.href,
): string {
  const browserLocation = new URL(browserUrl);
  const alphaSourceSha = ALPHA_DEPLOYMENT_PATH_PATTERN
    .exec(browserLocation.pathname)?.[1];
  const callbackUrl = new URL(
    alphaSourceSha === undefined
      ? "/auth/callback"
      : `/${alphaSourceSha}/auth/callback`,
    browserLocation,
  );
  callbackUrl.search = "";
  callbackUrl.hash = "";
  return callbackUrl.href;
}

export function createCloudflareOAuthAuthorizeUrl(
  frontendRedirectUri: string,
  oauthChannel: string,
  apiBaseUrl = resolveBackendApiBaseUrl(),
): string {
  if (!isCloudflareOAuthChannel(oauthChannel)) {
    throw new Error("OAuth channel is invalid.");
  }
  const authorizeUrl = new URL(
    "/v1/oauth/authorize",
    `${normalizeBackendApiBaseUrl(apiBaseUrl)}/`,
  );
  authorizeUrl.searchParams.set("frontend_redirect_uri", frontendRedirectUri);
  authorizeUrl.searchParams.set("oauth_channel", oauthChannel);
  return authorizeUrl.href;
}

export function parseCloudflareOAuthCallbackFragment(
  fragment: string,
): CloudflareOAuthResultMessage | null {
  const params = new URLSearchParams(fragment.replace(/^#/u, ""));
  const oauthChannel = params.get("oauth_channel");
  const code = readBoundedValue(params.get("code"));
  const error = readBoundedValue(params.get("error"));
  if (
    !isCloudflareOAuthChannel(oauthChannel)
    || (code === null) === (error === null)
  ) {
    return null;
  }
  return {
    type: "cloudflare-oauth-result",
    version: CLOUDFLARE_OAUTH_MESSAGE_VERSION,
    oauthChannel,
    ...(code === null ? { error: error as string } : { code }),
  };
}

export function isCloudflareOAuthResultMessage(
  value: unknown,
  expectedChannel: string,
): value is CloudflareOAuthResultMessage {
  if (!isRecord(value)) {
    return false;
  }
  const code = readBoundedValue(value.code);
  const error = readBoundedValue(value.error);
  return value.type === "cloudflare-oauth-result"
    && value.version === CLOUDFLARE_OAUTH_MESSAGE_VERSION
    && value.oauthChannel === expectedChannel
    && isCloudflareOAuthChannel(value.oauthChannel)
    && (code === null) !== (error === null);
}

export function createCloudflareOAuthAckMessage(
  oauthChannel: string,
): CloudflareOAuthAckMessage {
  if (!isCloudflareOAuthChannel(oauthChannel)) {
    throw new Error("OAuth channel is invalid.");
  }
  return {
    type: "cloudflare-oauth-ack",
    version: CLOUDFLARE_OAUTH_MESSAGE_VERSION,
    oauthChannel,
  };
}

export function isCloudflareOAuthAckMessage(
  value: unknown,
  expectedChannel: string,
): value is CloudflareOAuthAckMessage {
  return isRecord(value)
    && value.type === "cloudflare-oauth-ack"
    && value.version === CLOUDFLARE_OAUTH_MESSAGE_VERSION
    && value.oauthChannel === expectedChannel;
}

export function startCloudflareOAuthLogin(
  options: StartCloudflareOAuthLoginOptions = {},
): Promise<CloudflareOAuthSession> {
  if (typeof globalThis.BroadcastChannel !== "function") {
    return Promise.reject(new CloudflareOAuthLoginError(
      "broadcast_channel_unavailable",
      "BroadcastChannel is unavailable.",
    ));
  }

  const oauthChannel = options.oauthChannel ?? createCloudflareOAuthChannel();
  const frontendRedirectUri = options.frontendRedirectUri
    ?? createCloudflareOAuthFrontendRedirectUri();
  const broadcastChannel = new BroadcastChannel(
    createCloudflareOAuthBroadcastChannelName(oauthChannel),
  );
  const authorizeUrl = createCloudflareOAuthAuthorizeUrl(
    frontendRedirectUri,
    oauthChannel,
    options.apiBaseUrl,
  );
  let failLogin: (error: CloudflareOAuthLoginError) => void = () => undefined;
  const login = new Promise<CloudflareOAuthSession>((resolve, reject) => {
    let settled = false;
    const closeChannel = () => {
      if (settled) {
        return false;
      }
      settled = true;
      globalThis.clearTimeout(timeout);
      broadcastChannel.close();
      return true;
    };
    failLogin = (error) => {
      if (closeChannel()) {
        reject(error);
      }
    };
    const timeout = globalThis.setTimeout(() => {
      failLogin(new CloudflareOAuthLoginError(
        "login_timeout",
        "OAuth login timed out.",
      ));
    }, options.timeoutMs ?? CLOUDFLARE_OAUTH_LOGIN_TIMEOUT_MS);

    broadcastChannel.addEventListener("message", (event) => {
      if (!isCloudflareOAuthResultMessage(event.data, oauthChannel)) {
        return;
      }
      broadcastChannel.postMessage(createCloudflareOAuthAckMessage(oauthChannel));
      if (!closeChannel()) {
        return;
      }
      if (typeof event.data.error === "string") {
        reject(new CloudflareOAuthLoginError(
          "provider_error",
          "OAuth provider rejected the login.",
        ));
        return;
      }
      void completeCloudflareOAuthLogin(event.data.code as string, {
        apiBaseUrl: options.apiBaseUrl,
        fetchImpl: options.fetchImpl,
      }).then(resolve, reject);
    });
  });
  const popup = globalThis.open(
    authorizeUrl,
    "industrial-planner-cloudflare-oauth",
    "popup,width=520,height=720",
  );
  if (popup === null) {
    failLogin(new CloudflareOAuthLoginError(
      "popup_blocked",
      "OAuth popup was blocked.",
    ));
    return login;
  }
  try {
    popup.opener = null;
  } catch {
    // 跨域导航开始后 opener 可能已不可写；频道协议不依赖 opener。
  }

  return login;
}

function readBoundedValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized === "" || normalized.length > MAX_CALLBACK_VALUE_LENGTH
    ? null
    : normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
