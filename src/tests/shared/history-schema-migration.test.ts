import { afterEach, expect, it, vi } from "vitest";
import { readEditorHistoryState } from "@/editor/history/history-storage";
import { readFromIndexedDb, saveToIndexedDb } from "@/shared/storage/browser-storage";
import { createFakeIndexedDbFactory } from "./fake-indexed-db";

const location = { databaseName: "v3-industrial-planner", storeName: "editorhistory", key: "old-document" };
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

it("migrates schema 5 history entity changes exactly once before undo or redo", async () => {
  vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
  const entity = { id: "machine", definitionId: "liquid_furnance_1", position: { x: 0, y: 0 }, rotation: 0, config: {}, tags: [] };
  await saveToIndexedDb(location, {
    schemaVersion: 2, documentKey: location.key, cursorSequence: 1,
    records: [{ schemaVersion: 1, id: "change", documentKey: location.key, sequence: 1, createdAt: "2026-09-28T00:00:00Z",
      action: { type: "entity.rotate", label: "旋转", definitionIds: [entity.definitionId] },
      delta: { entities: { added: {}, removed: {}, updated: { machine: { before: entity, after: { ...entity, rotation: 90 } } } }, entityOrder: null, slotLinks: null, documentSettings: {} },
    }],
  });
  const history = await readEditorHistoryState(location.key);
  expect(history?.documentSchemaVersion).toBe(7);
  expect(history?.records[0]?.delta.entities.updated.machine).toMatchObject({
    before: { definitionId: "furnance_1_liquid", rotation: 180 }, after: { definitionId: "furnance_1_liquid", rotation: 270 },
  });
  expect(history?.records[0]?.action.definitionIds).toEqual(["furnance_1_liquid"]);
  expect(await readEditorHistoryState(location.key)).toEqual(history);
});

it("preserves malformed history instead of dropping records and saving an empty list", async () => {
  vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
  const original = { schemaVersion: 2, documentKey: location.key, cursorSequence: 1, records: [{ unknown: true }] };
  await saveToIndexedDb(location, original);
  await expect(readEditorHistoryState(location.key)).rejects.toThrow("Invalid editor history");
  expect(await readFromIndexedDb(location)).toEqual(original);
});

it("retains the continuous undo history after an incompatible legacy record", async () => {
  vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
  const entity = { id: "machine", definitionId: "liquid_furnance_1", position: { x: 0, y: 0 }, rotation: 0, config: {}, tags: [] };
  const record = (sequence: number, slotLinks: unknown) => ({
    schemaVersion: 1, id: `change-${sequence}`, documentKey: location.key, sequence, createdAt: "2026-09-28T00:00:00Z",
    action: { type: "entity.rotate", label: "旋转" },
    delta: {
      entities: sequence === 2 ? { added: {}, removed: {}, updated: { machine: { before: entity, after: { ...entity, rotation: 90 } } } } : { added: {}, removed: {}, updated: {} },
      entityOrder: null, slotLinks, documentSettings: {},
    },
  });
  await saveToIndexedDb(location, {
    schemaVersion: 2, documentKey: location.key, cursorSequence: 2,
    records: [
      record(1, { before: [{ source: { entityId: "missing-source" }, target: { entityId: "missing-target" } }], after: [] }),
      record(2, null),
    ],
  });

  const history = await readEditorHistoryState(location.key);

  expect(history).toMatchObject({ cursorSequence: 1, documentSchemaVersion: 7 });
  expect(history?.records).toHaveLength(1);
  expect(history?.records[0]).toMatchObject({ id: "change-2", sequence: 1 });
  expect(history?.records[0]?.delta.entities.updated.machine?.after).toMatchObject({
    definitionId: "furnance_1_liquid", rotation: 270,
  });
  expect(await readEditorHistoryState(location.key)).toEqual(history);
});

it("drops redo records from the first incompatible legacy record", async () => {
  vi.stubGlobal("indexedDB", createFakeIndexedDbFactory());
  const entity = { id: "machine", definitionId: "liquid_furnance_1", position: { x: 0, y: 0 }, rotation: 0, config: {}, tags: [] };
  const entityDelta = { added: {}, removed: {}, updated: { machine: { before: entity, after: { ...entity, rotation: 90 } } } };
  const record = (sequence: number, slotLinks: unknown) => ({
    schemaVersion: 1, id: `change-${sequence}`, documentKey: location.key, sequence, createdAt: "2026-09-28T00:00:00Z",
    action: { type: "entity.rotate", label: "旋转" },
    delta: { entities: entityDelta, entityOrder: null, slotLinks, documentSettings: {} },
  });
  await saveToIndexedDb(location, {
    schemaVersion: 2, documentKey: location.key, cursorSequence: 1,
    records: [
      record(1, null),
      record(2, { before: [{ source: { entityId: "missing-source" }, target: { entityId: "missing-target" } }], after: [] }),
      record(3, null),
    ],
  });

  const history = await readEditorHistoryState(location.key);

  expect(history?.cursorSequence).toBe(1);
  expect(history?.records.map(record => record.id)).toEqual(["change-1"]);
});
