import type { WorldDocument } from "@/domain/document/world-document";
import { shallowSnapshotEqual } from "./snapshot-selector";

export const selectDocumentBaseId = (document: WorldDocument) => document.baseId;
export const selectDocumentIdentity = (document: WorldDocument) => ({
  baseId: document.baseId,
  documentKey: document.documentKey,
});
export const selectDocumentEntities = (document: WorldDocument) => ({
  baseId: document.baseId,
  entities: document.entities,
  entityOrder: document.entityOrder,
});
export const selectDocumentTopology = (document: WorldDocument) => ({
  ...selectDocumentEntities(document),
  slotLinks: document.slotLinks,
});
export const selectDocumentPower = (document: WorldDocument) => ({
  ...selectDocumentEntities(document),
  powerMode: document.documentSettings.powerMode,
  powerConsumptionOverride: document.documentSettings.powerConsumptionOverride,
});
export const selectDocumentRegions = (document: WorldDocument) => ({
  ...selectDocumentEntities(document),
  regions: document.regions,
});

/** 内容消费者不读取 viewport；保留上一份内容快照避免无关的 React 更新。 */
export function sameDocumentContent(left: WorldDocument, right: WorldDocument): boolean {
  return shallowSnapshotEqual(selectDocumentTopology(left), selectDocumentTopology(right))
    && left.documentKey === right.documentKey
    && left.regions === right.regions
    && sameDocumentSettingsWithoutViewport(left.documentSettings, right.documentSettings);
}

export function sameDocumentSettingsWithoutViewport(
  left: WorldDocument["documentSettings"],
  right: WorldDocument["documentSettings"],
): boolean {
  if (left === right) return true;
  const keys = Object.keys(left).filter((key) => key !== "viewport");
  return keys.length === Object.keys(right).filter((key) => key !== "viewport").length
    && keys.every((key) => Object.hasOwn(right, key) && Object.is(left[key], right[key]));
}

export const selectDocumentSimulation = (document: WorldDocument) => ({
  ...selectDocumentTopology(document),
  ...selectDocumentPower(document),
});

export const selectDocumentContent = (document: WorldDocument) => document;

export function sameDocumentRemoteContent(left: WorldDocument, right: WorldDocument): boolean {
  return shallowSnapshotEqual(
    { ...left, documentKey: left.baseId, documentSettings: null },
    { ...right, documentKey: right.baseId, documentSettings: null },
  ) && sameDocumentSettingsWithoutViewport(left.documentSettings, right.documentSettings);
}
