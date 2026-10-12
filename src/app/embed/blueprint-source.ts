import { BLUEPRINT_SCHEMA_VERSION, type BlueprintDocument } from "@/domain/document/blueprint-document";
import { createWorldDocument, type WorldDocument } from "@/domain/document/world-document";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { normalizeBlueprintDocument } from "@/shared/blueprints/blueprint-document-codec";
import { resolveEntityGridGeometry } from "@/shared/geometry/entity-grid-geometry";

export interface BlueprintEmbedOptions {
  blueprintUrl: string;
  view: "3d-top" | "blueprint";
  animations: boolean;
  autoplay: boolean;
}

// 公共样本最大约 182 KiB；限制解压后的响应，避免外部输入无限占用内存。
export const EMBED_BLUEPRINT_MAX_BYTES = 4 * 1024 * 1024;

export function embedError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

export function parseBlueprintEmbedOptions(href: string): BlueprintEmbedOptions {
  const page = new URL(href);
  const params = page.searchParams;
  for (const key of ["embed", "blueprintUrl", "view", "animations", "autoplay"]) {
    if (params.getAll(key).length > 1) throw embedError("INVALID_PARAMETER", `参数 ${key} 不可重复。`);
  }
  const source = params.get("blueprintUrl");
  if (params.get("embed") !== "blueprint" || !source?.trim()) {
    throw embedError("INVALID_PARAMETER", "请提供蓝图文件地址。");
  }
  let url: URL;
  try { url = new URL(source, page); }
  catch { throw embedError("INVALID_PARAMETER", "蓝图文件地址无效。"); }
  const loopback = (value: string) => ["localhost", "127.0.0.1", "[::1]"].includes(value);
  const localDevelopment = page.protocol === "http:" && loopback(page.hostname)
    && url.protocol === "http:" && loopback(url.hostname);
  if ((url.protocol !== "https:" && !localDevelopment) || url.username || url.password || url.hash) {
    throw embedError("INVALID_PARAMETER", "蓝图地址须为不含凭据或片段的 HTTPS 文件地址。");
  }
  const view = params.get("view") ?? "3d-top";
  if (view !== "3d-top" && view !== "blueprint") throw embedError("INVALID_PARAMETER", "未知的蓝图显示模式。");
  const flag = (key: string) => {
    const value = params.get(key) ?? "0";
    if (value !== "0" && value !== "1") throw embedError("INVALID_PARAMETER", `参数 ${key} 必须为 0 或 1。`);
    return value === "1";
  };
  return { blueprintUrl: url.href, view, animations: flag("animations"), autoplay: flag("autoplay") };
}

export async function loadEmbedBlueprint(url: string, signal: AbortSignal): Promise<BlueprintDocument> {
  const response = await fetch(url, { signal, credentials: "omit", mode: "cors" });
  if (!response.ok) throw embedError("HTTP_ERROR", `蓝图加载失败（HTTP ${response.status}）。`);
  const reader = response.body?.getReader();
  if (!reader) throw embedError("INVALID_BLUEPRINT", "蓝图响应为空。");
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > EMBED_BLUEPRINT_MAX_BYTES) throw embedError("BLUEPRINT_TOO_LARGE", "蓝图文件不能超过 4 MiB。");
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  signal.throwIfAborted();
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw embedError("INVALID_JSON", "蓝图文件不是有效的 JSON。"); }
  return decodeEmbedBlueprint(value);
}

export function decodeEmbedBlueprint(value: unknown): BlueprintDocument {
  const invalid = () => embedError("INVALID_BLUEPRINT", "蓝图内容无效或超出支持范围。");
  if (!record(value) || !Number.isInteger(value.schemaVersion)) throw invalid();
  if (Number(value.schemaVersion) > BLUEPRINT_SCHEMA_VERSION) {
    throw embedError("UNSUPPORTED_VERSION", "蓝图版本高于当前查看器支持的版本。");
  }
  // 迁移前检查有限数值、嵌套深度与危险对象键，迁移后再核对实体和链接结构。
  const checkJson = (item: unknown, depth: number): void => {
    if (depth > 64 || typeof item === "number" && !Number.isFinite(item)) throw invalid();
    if (item !== null && typeof item === "object") {
      for (const [key, child] of Object.entries(item)) {
        if (["__proto__", "constructor", "prototype"].includes(key)) throw invalid();
        checkJson(child, depth + 1);
      }
    }
  };
  checkJson(value, 0);
  if (!record(value.entities) || Object.keys(value.entities).length > 20_000) throw invalid();
  for (const [id, entity] of Object.entries(value.entities)) {
    if (!record(entity) || entity.id !== id || typeof entity.definitionId !== "string"
      || !point(entity.position) || ![0, 90, 180, 270].includes(Number(entity.rotation))
      || typeof entity.rotation !== "number" || !record(entity.config)
      || !Array.isArray(entity.tags) || !entity.tags.every(tag => typeof tag === "string")) throw invalid();
  }
  let blueprint: BlueprintDocument | null;
  try { blueprint = normalizeBlueprintDocument(value); }
  catch { throw invalid(); }
  if (blueprint === null || !point(blueprint.initialGridPoint)
    || new Set(blueprint.entityOrder).size !== blueprint.entityOrder.length
    || blueprint.entityOrder.length !== Object.keys(blueprint.entities).length) throw invalid();
  for (const link of blueprint.slotLinks) {
    if (!link || typeof link.id !== "string" || !["share-all", "share-cap"].includes(link.linkType)) throw invalid();
    for (const endpoint of [link.source, link.target]) {
      if (!endpoint || typeof endpoint.entityId !== "string" || typeof endpoint.storageSlotGroupId !== "string"
        || typeof endpoint.slotId !== "string"
        || !(Object.hasOwn(blueprint.entities, endpoint.entityId) || endpoint.entityId === "warehouse")) throw invalid();
    }
  }
  return blueprint;
}

export function createEmbedWorldDocument(
  blueprint: BlueprintDocument,
  registry: RegistryContract,
  viewport?: { width: number; height: number; gridCellPixelSize: number },
): WorldDocument {
  if (!registry.baseDefinitions.some(base => base.id === blueprint.baseId)) {
    throw embedError("INVALID_BLUEPRINT", "蓝图引用了未知基地。");
  }
  for (const entity of Object.values(blueprint.entities)) {
    if (!registry.queries.findEntityDefinition(entity.definitionId)) {
      throw embedError("INVALID_BLUEPRINT", `蓝图引用了未知设备：${entity.definitionId}`);
    }
  }
  const document = createWorldDocument({ baseId: blueprint.baseId });
  const bounds = resolveEntityGridGeometry({
    entities: Object.values(blueprint.entities),
    entityDefinitionMap: new Map(registry.entityDefinitions.map(definition => [definition.id, definition])),
  })?.boundingBox;
  return {
    ...document,
    meta: { ...document.meta, name: blueprint.name },
    entities: structuredClone(blueprint.entities),
    entityOrder: [...blueprint.entityOrder],
    slotLinks: structuredClone(blueprint.slotLinks),
    regions: structuredClone(blueprint.regions),
    documentSettings: {
      ...document.documentSettings,
      viewport: {
        ...document.documentSettings.viewport,
        gridSize: bounds && viewport ? Math.min(1,
          viewport.width / ((bounds.width + 2) * viewport.gridCellPixelSize),
          viewport.height / ((bounds.height + 2) * viewport.gridCellPixelSize),
        ) : 1,
        center: bounds ? { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 } : { x: 0, y: 0 },
      },
    },
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function point(value: unknown): boolean {
  return record(value) && Number.isSafeInteger(value.x) && Number.isSafeInteger(value.y)
    && Math.abs(Number(value.x)) <= 100_000 && Math.abs(Number(value.y)) <= 100_000;
}
