// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const webDavLibraryClient = vi.hoisted(() => ({
  createDirectory: vi.fn(),
  deleteFile: vi.fn(),
  exists: vi.fn(),
  getDirectoryContents: vi.fn(),
  getFileContents: vi.fn(),
  moveFile: vi.fn(),
  putFileContents: vi.fn(),
  stat: vi.fn(),
}));

vi.mock("webdav", () => ({
  createClient: vi.fn(() => webDavLibraryClient),
}));

import { createWebDavStorageClient } from "@/sync";

describe("webdav-client", () => {
  beforeEach(() => {
    for (const mock of Object.values(webDavLibraryClient)) {
      mock.mockReset();
    }
    webDavLibraryClient.putFileContents.mockResolvedValue(true);
    webDavLibraryClient.moveFile.mockResolvedValue(undefined);
    webDavLibraryClient.deleteFile.mockResolvedValue(undefined);
  });

  it("implements exclusive creation through atomic MOVE without conditional CORS headers", async () => {
    const client = createWebDavStorageClient({
      baseUrl: "https://dav.example.test/",
    });

    await expect(client.writeTextFile(
      "assets/blueprints/index-revisions/rev-000000000001.json",
      "{\"revision\":1}",
      { ifNoneMatch: "*" },
    )).resolves.toBe(true);

    expect(webDavLibraryClient.putFileContents).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\/industrial-planner\/assets\/blueprints\/index-revisions\/rev-000000000001\.json\.tmp-/,
      ),
      "{\"revision\":1}",
      expect.objectContaining({
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
        overwrite: true,
        signal: expect.any(AbortSignal),
      }),
    );
    const temporaryPath = webDavLibraryClient.putFileContents.mock.calls[0]?.[0];
    expect(webDavLibraryClient.moveFile).toHaveBeenCalledWith(
      temporaryPath,
      "/industrial-planner/assets/blueprints/index-revisions/rev-000000000001.json",
      expect.objectContaining({
        overwrite: false,
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("cleans up the temporary resource when an atomic MOVE loses the revision race", async () => {
    const preconditionError = new Error("Precondition failed") as Error & { status?: number };
    preconditionError.status = 412;
    webDavLibraryClient.moveFile.mockRejectedValueOnce(preconditionError);
    const client = createWebDavStorageClient({
      baseUrl: "https://dav.example.test/",
    });

    await expect(client.writeTextFile(
      "documents/index-revisions/rev-000000000002.json",
      "{\"revision\":2}",
      { ifNoneMatch: "*" },
    )).rejects.toMatchObject({
      status: 412,
    });

    const temporaryPath = webDavLibraryClient.putFileContents.mock.calls[0]?.[0];
    expect(webDavLibraryClient.deleteFile).toHaveBeenCalledWith(
      temporaryPath,
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
  });
});
