// 通用同步存储客户端接口。
// 所有远端存储后端（WebDAV、R2 等）只需实现此接口，
// SyncAdapter 和 SyncService 即可透明切换。

export interface SyncClientOptions {
  readonly baseUrl: string;
  readonly username?: string;
  readonly password?: string;
  readonly rootPath?: string;
  readonly requestTimeoutMs?: number;
}

export interface SyncWriteOptions {
  readonly ifMatch?: string;
  readonly ifNoneMatch?: string;
  readonly contentType?: string;
}

export interface SyncReadOptions {
  readonly ifNoneMatch?: string;
}

export interface SyncTextFile {
  readonly content: string;
  readonly etag: string | null;
  readonly lastModified: string | null;
}

export interface SyncResourceStat {
  readonly path: string;
  readonly basename: string;
  readonly type: "file" | "directory";
  readonly etag: string | null;
  readonly lastModified: string;
  readonly size: number;
  readonly mime?: string;
}

export interface SyncStorageClient {
  readonly rootPath: string;
  exists(relativePath: string): Promise<boolean>;
  makeDirectory(relativePath: string): Promise<void>;
  listDirectory(relativePath: string): Promise<SyncResourceStat[]>;
  stat(relativePath: string): Promise<SyncResourceStat | null>;
  readTextFile(relativePath: string, options?: SyncReadOptions): Promise<SyncTextFile | null>;
  writeTextFile(relativePath: string, content: string, options?: SyncWriteOptions): Promise<boolean>;
  deleteResource(relativePath: string): Promise<void>;
  dispose?(): void;
}
