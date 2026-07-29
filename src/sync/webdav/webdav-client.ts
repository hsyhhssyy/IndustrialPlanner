import { createClient } from "webdav";
import { createLogger } from "@/shared/logging/logger";

const logger = createLogger("webdav-client");
const DEFAULT_ROOT_PATH = "/industrial-planner";
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export interface WebDavClientOptions {
  readonly baseUrl: string;
  readonly username?: string;
  readonly password?: string;
  readonly rootPath?: string;
  readonly requestTimeoutMs?: number;
}

export interface WebDavWriteOptions {
  readonly ifMatch?: string;
  readonly ifNoneMatch?: string;
  readonly contentType?: string;
}

export interface WebDavReadOptions {
  readonly ifNoneMatch?: string;
}

export interface WebDavTextFile {
  readonly content: string;
  readonly etag: string | null;
}

export interface WebDavResourceStat {
  readonly path: string;
  readonly basename: string;
  readonly type: "file" | "directory";
  readonly etag: string | null;
  readonly lastModified: string;
  readonly size: number;
  readonly mime?: string;
}

export interface WebDavStorageClient {
  readonly rootPath: string;
  exists(relativePath: string): Promise<boolean>;
  makeDirectory(relativePath: string): Promise<void>;
  listDirectory(relativePath: string): Promise<WebDavResourceStat[]>;
  stat(relativePath: string): Promise<WebDavResourceStat | null>;
  readTextFile(relativePath: string, options?: WebDavReadOptions): Promise<WebDavTextFile | null>;
  writeTextFile(relativePath: string, content: string, options?: WebDavWriteOptions): Promise<boolean>;
  deleteResource(relativePath: string): Promise<void>;
  dispose?(): void;
}

export function createWebDavStorageClient(options: WebDavClientOptions): WebDavStorageClient {
  const client = createClient(options.baseUrl, {
    username: options.username,
    password: options.password,
  });
  const rootPath = normalizeWebDavRootPath(options.rootPath ?? DEFAULT_ROOT_PATH);
  const requestTimeoutMs = normalizeRequestTimeoutMs(options.requestTimeoutMs);

  return {
    rootPath,
    exists: async (relativePath) => await runWithRequestTimeout(
      requestTimeoutMs,
      async (signal) => await client.exists(resolveRemotePath(rootPath, relativePath), { signal }),
    ),
    makeDirectory: async (relativePath) => {
      const fullPath = resolveRemotePath(rootPath, relativePath);
      logger.debug(`MKCOL ${fullPath}`);
      await runWithRequestTimeout(
        requestTimeoutMs,
        async (signal) => await client.createDirectory(fullPath, { recursive: true, signal }),
      );
    },
    listDirectory: async (relativePath) => {
      const entries = await runWithRequestTimeout(
        requestTimeoutMs,
        async (signal) => await client.getDirectoryContents(
          resolveRemotePath(rootPath, relativePath),
          { signal },
        ),
      );

      return entries.map(normalizeResourceStat);
    },
    stat: async (relativePath) => {
      try {
        const response = await runWithRequestTimeout(
          requestTimeoutMs,
          async (signal) => await client.stat(resolveRemotePath(rootPath, relativePath), { signal }),
        );

        return normalizeResourceStat(isDetailedResponse(response) ? response.data : response);
      } catch (error) {
        if (isNotFoundError(error)) {
          return null;
        }

        throw error;
      }
    },
    readTextFile: async (relativePath, readOptions = {}) => {
      try {
        const fullPath = resolveRemotePath(rootPath, relativePath);
        const response = await runWithRequestTimeout(
          requestTimeoutMs,
          async (signal) => await client.getFileContents(fullPath, {
            details: true,
            format: "text",
            headers: createConditionalHeaders(readOptions),
            signal,
          }),
        );

        if (!isDetailedResponse(response)) {
          logger.debug(`GET ${fullPath} → ${String(response).length} bytes (no etag)`);
          return {
            content: normalizeTextContent(response),
            etag: null,
          };
        }

        const etag = readHeader(response.headers, "etag");
        logger.debug(`GET ${fullPath} → ${String(response.data).length} bytes, etag=${etag ?? "null"}`);
        return {
          content: normalizeTextContent(response.data),
          etag,
        };
      } catch (error) {
        if (isNotFoundError(error)) {
          return null;
        }

        throw error;
      }
    },
    writeTextFile: async (relativePath, content, writeOptions = {}) => {
      const fullPath = resolveRemotePath(rootPath, relativePath);
      logger.debug(`PUT ${fullPath} (${content.length} bytes)`);
      if (writeOptions.ifNoneMatch === "*") {
        return await writeTextFileExclusively({
          client,
          content,
          contentType: writeOptions.contentType,
          fullPath,
          requestTimeoutMs,
        });
      }

      return await runWithRequestTimeout(
        requestTimeoutMs,
        async (signal) => await client.putFileContents(fullPath, content, {
          overwrite: true,
          headers: {
            "Content-Type": writeOptions.contentType ?? "application/json; charset=utf-8",
            ...createConditionalHeaders(writeOptions),
          },
          signal,
        }),
      );
    },
    deleteResource: async (relativePath) => {
      await runWithRequestTimeout(
        requestTimeoutMs,
        async (signal) => await client.deleteFile(resolveRemotePath(rootPath, relativePath), { signal }),
      );
    },
    dispose: () => {},
  };
}

async function writeTextFileExclusively(options: {
  readonly client: ReturnType<typeof createClient>;
  readonly content: string;
  readonly contentType: string | undefined;
  readonly fullPath: string;
  readonly requestTimeoutMs: number;
}): Promise<boolean> {
  const temporaryPath = `${options.fullPath}.tmp-${createTemporaryResourceId()}`;

  await runWithRequestTimeout(
    options.requestTimeoutMs,
    async (signal) => await options.client.putFileContents(temporaryPath, options.content, {
      overwrite: true,
      headers: {
        "Content-Type": options.contentType ?? "application/json; charset=utf-8",
      },
      signal,
    }),
  );

  try {
    await runWithRequestTimeout(
      options.requestTimeoutMs,
      async (signal) => await options.client.moveFile(temporaryPath, options.fullPath, {
        overwrite: false,
        signal,
      }),
    );
    return true;
  } catch (error) {
    try {
      await runWithRequestTimeout(
        options.requestTimeoutMs,
        async (signal) => await options.client.deleteFile(temporaryPath, { signal }),
      );
    } catch {
      // 原子提交失败后的临时文件清理由后续服务端维护处理，不覆盖原始错误。
    }

    throw error;
  }
}

export function normalizeWebDavRootPath(path: string): string {
  const normalized = normalizeRelativePath(path);

  return normalized === "/" ? "/" : `/${normalized}`;
}

function normalizeRequestTimeoutMs(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : DEFAULT_REQUEST_TIMEOUT_MS;
}

function resolveRemotePath(rootPath: string, relativePath: string): string {
  const normalizedRelativePath = normalizeRelativePath(relativePath);

  if (rootPath === "/") {
    return `/${normalizedRelativePath}`;
  }

  return normalizedRelativePath === "" ? rootPath : `${rootPath}/${normalizedRelativePath}`;
}

function normalizeRelativePath(path: string): string {
  return path
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== ".")
    .join("/");
}

function normalizeResourceStat(value: {
  filename: string;
  basename: string;
  type: "file" | "directory";
  etag: string | null;
  lastmod: string;
  size: number;
  mime?: string;
}): WebDavResourceStat {
  return {
    path: value.filename,
    basename: value.basename,
    type: value.type,
    etag: value.etag,
    lastModified: value.lastmod,
    size: value.size,
    ...(value.mime === undefined ? {} : { mime: value.mime }),
  };
}

function createConditionalHeaders(options: WebDavReadOptions | WebDavWriteOptions): Record<string, string> {
  return {
    ...(options.ifNoneMatch === undefined ? {} : { "If-None-Match": options.ifNoneMatch }),
    ...("ifMatch" in options && options.ifMatch !== undefined ? { "If-Match": options.ifMatch } : {}),
  };
}

async function runWithRequestTimeout<TValue>(
  requestTimeoutMs: number,
  task: (signal: AbortSignal) => Promise<TValue>,
): Promise<TValue> {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => {
    controller.abort(new Error(`WebDAV request timed out after ${requestTimeoutMs}ms.`));
  }, requestTimeoutMs);

  try {
    return await task(controller.signal);
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

function createTemporaryResourceId(): string {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function normalizeTextContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value instanceof ArrayBuffer) {
    return new TextDecoder().decode(value);
  }

  return String(value);
}

function isDetailedResponse(value: unknown): value is {
  readonly data: unknown;
  readonly headers: Record<string, string>;
} {
  return isRecord(value) && "data" in value && isRecord(value.headers);
}

function readHeader(headers: Readonly<Record<string, string>>, name: string): string | null {
  const lowerName = name.toLowerCase();
  const entry = Object.entries(headers).find(([headerName]) => headerName.toLowerCase() === lowerName);

  return entry?.[1] ?? null;
}

function isNotFoundError(error: unknown): boolean {
  return isRecord(error) && error.status === 404;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
