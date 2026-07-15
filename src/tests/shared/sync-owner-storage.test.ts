import { afterEach, describe, expect, it, vi } from "vitest";

import {
  activateAccountOwnerAfterImport,
  ensureLocalSyncOwnerState,
  readLocalSyncOwnerState,
  recordPendingAccountImportDecision,
} from "@/shared/storage/sync-owner-storage";
import { createFakeIndexedDbFactory } from "./fake-indexed-db";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sync owner storage", () => {
  it("creates a stable anonymous owner for local-only use", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    const firstState = await ensureLocalSyncOwnerState({
      now: "2026-07-15T00:00:00.000Z",
    });
    const secondState = await ensureLocalSyncOwnerState({
      now: "2026-07-15T01:00:00.000Z",
    });

    expect(firstState).toEqual(secondState);
    expect(firstState.activeOwner).toEqual({
      kind: "anonymous",
      ownerId: firstState.anonymousDatasetId,
    });
    expect(firstState.installId).not.toBe(firstState.deviceId);
    expect(firstState.pendingAccountImport).toBeNull();
  });

  it("records an explicit import decision when a non-empty account logs in", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());

    const anonymousState = await ensureLocalSyncOwnerState({
      now: "2026-07-15T00:00:00.000Z",
    });
    const pendingState = await recordPendingAccountImportDecision({
      userId: "user-1",
      remoteDatasetStatus: "non-empty",
      now: "2026-07-15T00:10:00.000Z",
    });

    expect(pendingState.activeOwner).toEqual(anonymousState.activeOwner);
    expect(pendingState.pendingAccountImport).toMatchObject({
      userId: "user-1",
      anonymousDatasetId: anonymousState.anonymousDatasetId,
      remoteDatasetStatus: "non-empty",
      requiredDecision: "choose-overwrite-or-keep-remote",
      createdAt: "2026-07-15T00:10:00.000Z",
      updatedAt: "2026-07-15T00:10:00.000Z",
    });

    const activatedState = await activateAccountOwnerAfterImport({
      userId: "user-1",
      resolution: "kept-remote",
      now: "2026-07-15T00:20:00.000Z",
    });
    const persistedState = await readLocalSyncOwnerState();

    expect(activatedState.activeOwner).toEqual({
      kind: "account",
      ownerId: "user-1",
    });
    expect(activatedState.pendingAccountImport).toBeNull();
    expect(activatedState.lastCompletedAccountImport).toMatchObject({
      userId: "user-1",
      anonymousDatasetId: anonymousState.anonymousDatasetId,
      resolution: "kept-remote",
      completedAt: "2026-07-15T00:20:00.000Z",
    });
    expect(persistedState).toEqual(activatedState);
  });
});
