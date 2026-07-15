import { createUuid } from "@/domain/shared/uuid";

import {
  readFromIndexedDb,
  saveToIndexedDb,
  type IndexedDbStoreLocation,
} from "./browser-storage";

const SYNC_OWNER_DATABASE_NAME = "v3-industrial-planner";
const SYNC_OWNER_STATE_STORE_NAME = "sync-owner-state";
const SYNC_OWNER_STATE_KEY = "local-sync-owner-state";
const SYNC_OWNER_SCHEMA_VERSION = 1;

export const SYNC_OWNER_STATE_STORE_LOCATION: IndexedDbStoreLocation = {
  databaseName: SYNC_OWNER_DATABASE_NAME,
  storeName: SYNC_OWNER_STATE_STORE_NAME,
};

export type LocalSyncOwnerKind = "anonymous" | "account";

export interface LocalSyncDataOwner {
  readonly kind: LocalSyncOwnerKind;
  readonly ownerId: string;
}

export type LocalAccountRemoteDatasetStatus = "empty" | "non-empty";

export type LocalAccountImportRequiredDecision =
  | "import-anonymous"
  | "choose-overwrite-or-keep-remote";

export type LocalAccountImportResolution =
  | "imported-anonymous"
  | "kept-remote"
  | "overwrote-remote";

export interface LocalPendingAccountImport {
  readonly userId: string;
  readonly anonymousDatasetId: string;
  readonly remoteDatasetStatus: LocalAccountRemoteDatasetStatus;
  readonly requiredDecision: LocalAccountImportRequiredDecision;
  readonly idempotencyKey: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LocalCompletedAccountImport {
  readonly userId: string;
  readonly anonymousDatasetId: string;
  readonly resolution: LocalAccountImportResolution;
  readonly idempotencyKey: string;
  readonly completedAt: string;
}

export interface LocalSyncOwnerState {
  readonly schemaVersion: number;
  readonly installId: string;
  readonly deviceId: string;
  readonly anonymousDatasetId: string;
  readonly activeOwner: LocalSyncDataOwner;
  readonly pendingAccountImport: LocalPendingAccountImport | null;
  readonly lastCompletedAccountImport: LocalCompletedAccountImport | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export async function readLocalSyncOwnerState(): Promise<LocalSyncOwnerState | null> {
  const rawState = await readFromIndexedDb<unknown>({
    ...SYNC_OWNER_STATE_STORE_LOCATION,
    key: SYNC_OWNER_STATE_KEY,
  });

  return normalizeLocalSyncOwnerState(rawState);
}

export async function ensureLocalSyncOwnerState(options: {
  readonly now?: string;
} = {}): Promise<LocalSyncOwnerState> {
  const existingState = await readLocalSyncOwnerState();

  if (existingState !== null) {
    return existingState;
  }

  const timestamp = options.now ?? new Date().toISOString();
  const anonymousDatasetId = createUuid();
  const state: LocalSyncOwnerState = {
    schemaVersion: SYNC_OWNER_SCHEMA_VERSION,
    installId: createUuid(),
    deviceId: createUuid(),
    anonymousDatasetId,
    activeOwner: {
      kind: "anonymous",
      ownerId: anonymousDatasetId,
    },
    pendingAccountImport: null,
    lastCompletedAccountImport: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await saveLocalSyncOwnerState(state);

  return state;
}

export async function recordPendingAccountImportDecision(options: {
  readonly userId: string;
  readonly remoteDatasetStatus: LocalAccountRemoteDatasetStatus;
  readonly now?: string;
}): Promise<LocalSyncOwnerState> {
  const userId = normalizeNonEmptyString(options.userId);

  if (userId === null) {
    throw new Error("Account user id is required.");
  }

  const timestamp = options.now ?? new Date().toISOString();
  const existingState = await ensureLocalSyncOwnerState({ now: timestamp });
  const existingImport = existingState.pendingAccountImport;
  const shouldReuseImport =
    existingImport !== null
    && existingImport.userId === userId
    && existingImport.anonymousDatasetId === existingState.anonymousDatasetId
    && existingImport.remoteDatasetStatus === options.remoteDatasetStatus;
  const pendingAccountImport: LocalPendingAccountImport = shouldReuseImport
    ? {
      ...existingImport,
      updatedAt: timestamp,
    }
    : {
      userId,
      anonymousDatasetId: existingState.anonymousDatasetId,
      remoteDatasetStatus: options.remoteDatasetStatus,
      requiredDecision: options.remoteDatasetStatus === "empty"
        ? "import-anonymous"
        : "choose-overwrite-or-keep-remote",
      idempotencyKey: createUuid(),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  const nextState: LocalSyncOwnerState = {
    ...existingState,
    pendingAccountImport,
    updatedAt: timestamp,
  };

  await saveLocalSyncOwnerState(nextState);

  return nextState;
}

export async function activateAccountOwnerAfterImport(options: {
  readonly userId: string;
  readonly resolution: LocalAccountImportResolution;
  readonly now?: string;
}): Promise<LocalSyncOwnerState> {
  const userId = normalizeNonEmptyString(options.userId);

  if (userId === null) {
    throw new Error("Account user id is required.");
  }

  const timestamp = options.now ?? new Date().toISOString();
  const existingState = await ensureLocalSyncOwnerState({ now: timestamp });
  const pendingImport = existingState.pendingAccountImport;
  const idempotencyKey = pendingImport?.userId === userId
    ? pendingImport.idempotencyKey
    : createUuid();
  const anonymousDatasetId = pendingImport?.userId === userId
    ? pendingImport.anonymousDatasetId
    : existingState.anonymousDatasetId;
  const nextState: LocalSyncOwnerState = {
    ...existingState,
    activeOwner: {
      kind: "account",
      ownerId: userId,
    },
    pendingAccountImport: null,
    lastCompletedAccountImport: {
      userId,
      anonymousDatasetId,
      resolution: options.resolution,
      idempotencyKey,
      completedAt: timestamp,
    },
    updatedAt: timestamp,
  };

  await saveLocalSyncOwnerState(nextState);

  return nextState;
}

export function createLocalSyncOwnerScopeKey(owner: LocalSyncDataOwner): string {
  return `${owner.kind}:${owner.ownerId}`;
}

export function areLocalSyncDataOwnersEqual(
  left: LocalSyncDataOwner,
  right: LocalSyncDataOwner,
): boolean {
  return left.kind === right.kind && left.ownerId === right.ownerId;
}

export function normalizeLocalSyncDataOwner(value: unknown): LocalSyncDataOwner | null {
  if (!isRecord(value)) {
    return null;
  }

  const ownerId = normalizeNonEmptyString(value.ownerId);

  if ((value.kind !== "anonymous" && value.kind !== "account") || ownerId === null) {
    return null;
  }

  return {
    kind: value.kind,
    ownerId,
  };
}

async function saveLocalSyncOwnerState(state: LocalSyncOwnerState): Promise<void> {
  await saveToIndexedDb({
    ...SYNC_OWNER_STATE_STORE_LOCATION,
    key: SYNC_OWNER_STATE_KEY,
  }, state);
}

function normalizeLocalSyncOwnerState(value: unknown): LocalSyncOwnerState | null {
  if (!isRecord(value)) {
    return null;
  }

  const installId = normalizeNonEmptyString(value.installId);
  const deviceId = normalizeNonEmptyString(value.deviceId);
  const anonymousDatasetId = normalizeNonEmptyString(value.anonymousDatasetId);
  const activeOwner = normalizeLocalSyncDataOwner(value.activeOwner);
  const createdAt = normalizeTimestamp(value.createdAt);
  const updatedAt = normalizeTimestamp(value.updatedAt);

  if (
    installId === null
    || deviceId === null
    || anonymousDatasetId === null
    || activeOwner === null
    || createdAt === null
    || updatedAt === null
  ) {
    return null;
  }

  return {
    schemaVersion: normalizePositiveInteger(value.schemaVersion, SYNC_OWNER_SCHEMA_VERSION),
    installId,
    deviceId,
    anonymousDatasetId,
    activeOwner,
    pendingAccountImport: normalizeLocalPendingAccountImport(value.pendingAccountImport),
    lastCompletedAccountImport: normalizeLocalCompletedAccountImport(
      value.lastCompletedAccountImport,
    ),
    createdAt,
    updatedAt,
  };
}

function normalizeLocalPendingAccountImport(value: unknown): LocalPendingAccountImport | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const userId = normalizeNonEmptyString(value.userId);
  const anonymousDatasetId = normalizeNonEmptyString(value.anonymousDatasetId);
  const idempotencyKey = normalizeNonEmptyString(value.idempotencyKey);
  const createdAt = normalizeTimestamp(value.createdAt);
  const updatedAt = normalizeTimestamp(value.updatedAt);

  if (
    userId === null
    || anonymousDatasetId === null
    || idempotencyKey === null
    || createdAt === null
    || updatedAt === null
    || !isLocalAccountRemoteDatasetStatus(value.remoteDatasetStatus)
    || !isLocalAccountImportRequiredDecision(value.requiredDecision)
  ) {
    return null;
  }

  return {
    userId,
    anonymousDatasetId,
    remoteDatasetStatus: value.remoteDatasetStatus,
    requiredDecision: value.requiredDecision,
    idempotencyKey,
    createdAt,
    updatedAt,
  };
}

function normalizeLocalCompletedAccountImport(value: unknown): LocalCompletedAccountImport | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const userId = normalizeNonEmptyString(value.userId);
  const anonymousDatasetId = normalizeNonEmptyString(value.anonymousDatasetId);
  const idempotencyKey = normalizeNonEmptyString(value.idempotencyKey);
  const completedAt = normalizeTimestamp(value.completedAt);

  if (
    userId === null
    || anonymousDatasetId === null
    || idempotencyKey === null
    || completedAt === null
    || !isLocalAccountImportResolution(value.resolution)
  ) {
    return null;
  }

  return {
    userId,
    anonymousDatasetId,
    resolution: value.resolution,
    idempotencyKey,
    completedAt,
  };
}

function isLocalAccountRemoteDatasetStatus(
  value: unknown,
): value is LocalAccountRemoteDatasetStatus {
  return value === "empty" || value === "non-empty";
}

function isLocalAccountImportRequiredDecision(
  value: unknown,
): value is LocalAccountImportRequiredDecision {
  return value === "import-anonymous" || value === "choose-overwrite-or-keep-remote";
}

function isLocalAccountImportResolution(value: unknown): value is LocalAccountImportResolution {
  return (
    value === "imported-anonymous"
    || value === "kept-remote"
    || value === "overwrote-remote"
  );
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return Number.isNaN(Date.parse(value)) ? null : value;
}

function normalizeNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
