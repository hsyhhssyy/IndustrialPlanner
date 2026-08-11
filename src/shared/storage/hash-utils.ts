// AI-CORRECTION 2026-08-08:
// 从 sync-shadow-storage.ts 提取的纯 hash 工具函数。
// 原文件中的 Shadow 专属代码（outbox、diagnostic、compact summary 等）已注释化删除。
// 这两个 hash 函数被 sync/sync-host.ts、sync/engine/sync-adapters.ts、
// sync/clients/webdav/webdav-remote.ts、sync/clients/cloudflare/cloudflare-worker-runtime.ts 使用，
// 与 Sync Shadow 完全无关。
// AI-CORRECTION 2026-08-09: 本文件现在也提供 canonical JSON 序列化与原始字节 SHA-256，
// 供 blob 协议保证“声明的哈希、字节数、实际传输体”来自同一份字节。
export function createStableJsonHash(value: unknown): string {
  return `fnv1a32:${hashStringFNV1a32(stringifyCanonicalJson(value)).toString(16).padStart(8, "0")}`;
}

export async function createSha256CanonicalHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stringifyCanonicalJson(value));
  return await createSha256Hash(bytes);
}

export async function createSha256Hash(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);

  return `sha256:${Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

export function stringifyCanonicalJson(value: unknown): string {
  return stableStringify(value);
}

function stableStringify(value: unknown): string {
  if (value === undefined) {
    return "null";
  }

  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();

  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function hashStringFNV1a32(value: string): number {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}
