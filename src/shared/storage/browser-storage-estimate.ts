/**
 * 估算当前域名下浏览器存储的总占用大小（bytes）。
 * 优先使用 navigator.storage.estimate()，不支持时回退到手动计算
 * localStorage + sessionStorage。
 */
export async function estimateTotalStorageBytes(): Promise<number | null> {
  if (typeof navigator !== "undefined" && "storage" in navigator && "estimate" in navigator.storage) {
    try {
      const estimate = await navigator.storage.estimate();
      if (typeof estimate.usage === "number") {
        return estimate.usage;
      }
    } catch {
      // 静默回退
    }
  }

  return estimateLocalAndSessionStorageBytes();
}

/** 手动计算 localStorage + sessionStorage 的字节占用 */
function estimateLocalAndSessionStorageBytes(): number {
  let total = 0;

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key !== null) {
        total += key.length + (localStorage.getItem(key)?.length ?? 0);
      }
    }
  } catch {
    // localStorage 不可用
  }

  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key !== null) {
        total += key.length + (sessionStorage.getItem(key)?.length ?? 0);
      }
    }
  } catch {
    // sessionStorage 不可用
  }

  // UTF-16 编码，每个字符约 2 bytes
  return total * 2;
}

/**
 * 清空当前域名下所有浏览器存储（localStorage、sessionStorage、IndexedDB），
 * 然后刷新页面。
 */
export async function clearAllStorageAndReload(): Promise<void> {
  try {
    localStorage.clear();
  } catch {
    // 忽略错误
  }

  try {
    sessionStorage.clear();
  } catch {
    // 忽略错误
  }

  // 删除所有 IndexedDB 数据库
  if (typeof indexedDB !== "undefined" && "databases" in indexedDB) {
    try {
      const databases = await indexedDB.databases();
      for (const db of databases) {
        if (db.name) {
          indexedDB.deleteDatabase(db.name);
        }
      }
    } catch {
      // 忽略错误
    }
  }

  window.location.reload();
}

/** 将 bytes 格式化为人类可读的 MB 字符串 */
export function formatStorageBytesToMB(bytes: number | null): string {
  if (bytes === null) {
    return "— MB";
  }

  const mb = bytes / (1024 * 1024);
  if (mb < 0.01) {
    return "< 0.01 MB";
  }

  return `${mb.toFixed(2)} MB`;
}
