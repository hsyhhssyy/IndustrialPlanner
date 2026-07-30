import { createClient } from "webdav";
import { createLogger } from "@/shared/logging/logger";
import type {
  SyncClientOptions,
  SyncReadOptions,
  SyncResourceStat,
  SyncStorageClient,
  SyncTextFile,
  SyncWriteOptions,
} from "../types";

const logger = createLogger("webdav-client");
const DEFAULT_ROOT_PATH = "/industrial-planner";
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

// AI-CORRECTION 2026-07-30: 类型已迁移到通用 ../types，以下别名保持向后兼容。
export type WebDavClientOptions = SyncClientOptions;
export type WebDavWriteOptions = SyncWriteOptions;
export type WebDavReadOptions = SyncReadOptions;
export type WebDavTextFile = SyncTextFile;
export type WebDavResourceStat = SyncResourceStat;
export type WebDavStorageClient = SyncStorageClient;

export function createWebDavStorageClient(options: SyncClientOptions): SyncStorageClient {
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
      try {
        await runWithRequestTimeout(
          requestTimeoutMs,
          async (signal) => await client.createDirectory(fullPath, {
            recursive: true,
            signal,
          }),
        );
      } catch (error) {
        if (!isMethodNotAllowedError(error)) {
          throw error;
        }

        const existingResponse = await runWithRequestTimeout(
          requestTimeoutMs,
          async (signal) => await client.stat(fullPath, { signal }),
        );
        const existing = normalizeResourceStat(
          isDetailedResponse(existingResponse)
            ? existingResponse.data
            : existingResponse,
        );
        if (existing.type !== "directory") {
          throw error;
        }
        logger.debug(`MKCOL ${fullPath} → already exists`);
      }
      // AI-REMOVED 2026-07-29:
      // Reason: 并行资源首次上传会并发创建相同父目录，OwnCloud 对后到请求返回 405。
      // Trigger: 真实双资源批量冲突验证在并发创建验证根目录时失败。
      // Evidence: 405 后对相同路径执行 PROPFIND，目标已经是 directory。
      // Replacement: 上方仅在确认目标目录已存在时接受 405 的幂等流程。
      // Risk: Low；非目录或其他错误仍原样抛出。
      // Human Review: Required
      //
      // Original code:
      // await runWithRequestTimeout(
      //   requestTimeoutMs,
      //   async (signal) => await client.createDirectory(fullPath, { recursive: true, signal }),
      // );
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
            lastModified: null,
          };
        }

        const etag = readHeader(response.headers, "etag");
        const lastModified = readHeader(response.headers, "last-modified");
        logger.debug(`GET ${fullPath} → ${String(response.data).length} bytes, etag=${etag ?? "null"}`);
        return {
          content: normalizeTextContent(response.data),
          etag,
          lastModified,
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

function isMethodNotAllowedError(error: unknown): boolean {
  return isRecord(error) && error.status === 405;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
