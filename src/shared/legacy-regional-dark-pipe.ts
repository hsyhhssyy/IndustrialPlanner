import type { WorldDocument } from "@/domain/document/world-document";
import type { RegionalDarkPipeEndpoint } from "@/domain/shared/dark-pipe-link";
import {
  createDarkPipeSlotLink,
  createRegionalDarkPipeLink,
  findDarkPipeSlotLinkForEntity,
  findRegionalDarkPipeLinkForEndpoint,
  isSameRegionalDarkPipeEndpoint,
  listDocumentRegionalDarkPipeLinks,
  prepareDarkPipeLinkDocument,
  resolveDarkPipeRole,
} from "./dark-pipe-link";

/** 仅用于读取并清空未发布版本中的旧关系，不作为新关系的保存入口。 */
export const LEGACY_REGIONAL_SETTINGS_LOCATION = {
  databaseName: "v3-industrial-planner", storeName: "regional-settings", key: "default",
} as const;

export interface LegacyRegionalDarkPipeAsset {
  readonly raw: Record<string, unknown>;
  readonly data: Record<string, unknown>;
  readonly links: readonly unknown[];
}

export function readLegacyRegionalDarkPipeAsset(raw: unknown): LegacyRegionalDarkPipeAsset | null {
  if (!isRecord(raw) || !isRecord(raw.data) || raw.data.schemaVersion !== 2
    || !Array.isArray(raw.data.darkPipeLinks) || raw.data.darkPipeLinks.length === 0) return null;
  return { raw, data: raw.data, links: raw.data.darkPipeLinks };
}

/** 无效记录保留原文；已迁入的同一关系只移除旧记录，不重复配置端点。 */
export function planLegacyRegionalDarkPipeMigration(options: {
  readonly asset: LegacyRegionalDarkPipeAsset;
  readonly documents: readonly WorldDocument[];
  readonly bases: readonly { readonly id: string; readonly tag: string }[];
}) {
  const working = new Map(options.documents.map(document => [document.baseId, document]));
  const retained: unknown[] = [];
  const diagnostics: string[] = [];
  for (const raw of options.asset.links) {
    const inlet = isRecord(raw) ? readEndpoint(raw.inlet) : null;
    const outlet = isRecord(raw) ? readEndpoint(raw.outlet) : null;
    const reject = (reason: string) => { retained.push(raw); diagnostics.push(reason); };
    if (inlet === null || outlet === null || inlet.baseId === outlet.baseId) {
      reject("旧暗管关系的端点格式无效。");
      continue;
    }
    const inletBase = options.bases.find(base => base.id === inlet.baseId);
    const outletBase = options.bases.find(base => base.id === outlet.baseId);
    const inletDocument = working.get(inlet.baseId);
    const outletDocument = working.get(outlet.baseId);
    if (inletBase === undefined || outletBase === undefined || inletBase.tag !== outletBase.tag
      || inletDocument === undefined || outletDocument === undefined) {
      reject(`旧暗管关系 ${outlet.baseId}/${outlet.entityId} 的基地缺失或不在同一区域。`);
      continue;
    }
    if (resolveDarkPipeRole(inletDocument.entities[inlet.entityId]?.definitionId ?? "") !== "inlet"
      || resolveDarkPipeRole(outletDocument.entities[outlet.entityId]?.definitionId ?? "") !== "outlet") {
      reject(`旧暗管关系 ${outlet.baseId}/${outlet.entityId} 的设备缺失或角色不匹配。`);
      continue;
    }
    const relations = listDocumentRegionalDarkPipeLinks([...working.values()]);
    const existingInlet = findRegionalDarkPipeLinkForEndpoint(relations, inlet);
    const existingOutlet = findRegionalDarkPipeLinkForEndpoint(relations, outlet);
    if (existingInlet !== null && existingOutlet === existingInlet
      && isSameRegionalDarkPipeEndpoint(existingInlet.inlet, inlet)
      && isSameRegionalDarkPipeEndpoint(existingInlet.outlet, outlet)) continue;
    if (existingInlet !== null || existingOutlet !== null
      || findDarkPipeSlotLinkForEntity(inletDocument, inlet.entityId) !== null
      || findDarkPipeSlotLinkForEntity(outletDocument, outlet.entityId) !== null) {
      reject(`旧暗管关系 ${outlet.baseId}/${outlet.entityId} 与文档中的现有连接冲突。`);
      continue;
    }
    const relative = createDarkPipeSlotLink({ inletEntityId: inlet.entityId, outletEntityId: outlet.entityId });
    const prepared = prepareDarkPipeLinkDocument(outletDocument, [outlet.entityId]);
    working.set(inlet.baseId, prepareDarkPipeLinkDocument(inletDocument, [inlet.entityId]));
    working.set(outlet.baseId, {
      ...prepared,
      meta: { ...prepared.meta, updatedAt: new Date().toISOString() },
      slotLinks: [...prepared.slotLinks, {
        ...relative, id: createRegionalDarkPipeLink({ inlet, outlet }).id,
        target: { ...relative.target, baseId: inlet.baseId },
      }],
    });
  }
  return {
    changed: retained.length !== options.asset.links.length,
    nextAsset: { ...options.asset.raw, data: { ...options.asset.data, darkPipeLinks: retained } },
    changes: options.documents.map(before => ({ before, after: working.get(before.baseId)! })),
    diagnostics,
  };
}

function readEndpoint(value: unknown): RegionalDarkPipeEndpoint | null {
  if (!isRecord(value) || typeof value.baseId !== "string" || value.baseId.trim() === ""
    || typeof value.entityId !== "string" || value.entityId.trim() === "") return null;
  return { baseId: value.baseId, entityId: value.entityId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
