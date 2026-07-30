// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getLogLevel,
  setLogLevel,
} from "@/shared/logging/logger";
import type {
  WebDavResourceStat,
  WebDavStorageClient,
  WebDavTextFile,
  WebDavWriteOptions,
} from "@/sync";
import { WebDavWorkerRuntime } from "@/sync/clients/webdav/webdav-worker-runtime";

class MemoryWorkerWebDavClient implements WebDavStorageClient {
  public readonly rootPath = "/industrial-planner";
  public readonly files = new Map<string, string>();

  public async exists(relativePath: string): Promise<boolean> {
    return this.files.has(relativePath);
  }

  public async makeDirectory(_relativePath: string): Promise<void> {}

  public async listDirectory(_relativePath: string): Promise<WebDavResourceStat[]> {
    return [];
  }

  public async stat(_relativePath: string): Promise<WebDavResourceStat | null> {
    return null;
  }

  public async readTextFile(relativePath: string): Promise<WebDavTextFile | null> {
    const content = this.files.get(relativePath);

    return content === undefined ? null : {
      content,
      etag: null,
      lastModified: "2026-07-29T12:00:00.000Z",
    };
  }

  public async writeTextFile(
    relativePath: string,
    content: string,
    _options?: WebDavWriteOptions,
  ): Promise<boolean> {
    this.files.set(relativePath, content);
    return true;
  }

  public async deleteResource(relativePath: string): Promise<void> {
    this.files.delete(relativePath);
  }
}

describe("WebDavWorkerRuntime", () => {
  const previousLogLevel = getLogLevel();

  afterEach(() => {
    setLogLevel(previousLogLevel);
    vi.restoreAllMocks();
  });

  it("executes network operations and only records them when debug mode is enabled", async () => {
    const client = new MemoryWorkerWebDavClient();
    const consoleDebug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const runtime = new WebDavWorkerRuntime({
      createClient: () => client,
    });

    await runtime.handleRequest({
      requestId: 1,
      clientOptions: { baseUrl: "https://dav.example.test/" },
      debugEnabled: false,
      operation: {
        type: "write-text-file",
        relativePath: "assets/test.json",
        content: "{\"value\":1}",
        options: {},
      },
    });
    expect(consoleDebug).not.toHaveBeenCalled();
    expect(client.files.get("assets/test.json")).toBe("{\"value\":1}");

    await runtime.handleRequest({
      requestId: 2,
      clientOptions: { baseUrl: "https://dav.example.test/" },
      debugEnabled: true,
      operation: {
        type: "read-text-file",
        relativePath: "assets/test.json",
        options: {},
      },
    });

    expect(consoleDebug).toHaveBeenCalledWith(
      expect.stringContaining("[industrial-planner:webdav-worker] GET assets/test.json → started"),
    );
    expect(consoleDebug).toHaveBeenCalledWith(
      expect.stringContaining("[industrial-planner:webdav-worker] GET assets/test.json → completed"),
    );
  });

  it("returns serializable HTTP status errors without unconditional console output", async () => {
    const client = new MemoryWorkerWebDavClient();
    client.readTextFile = async () => {
      const error = new Error("Precondition failed") as Error & { status?: number };
      error.status = 412;
      throw error;
    };
    const consoleDebug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const runtime = new WebDavWorkerRuntime({
      createClient: () => client,
    });

    const response = await runtime.handleRequest({
      requestId: 3,
      clientOptions: { baseUrl: "https://dav.example.test/" },
      debugEnabled: false,
      operation: {
        type: "read-text-file",
        relativePath: "assets/test.json",
        options: {},
      },
    });

    expect(response).toMatchObject({
      ok: false,
      error: {
        message: "Precondition failed",
        status: 412,
      },
    });
    expect(consoleDebug).not.toHaveBeenCalled();
  });
});
