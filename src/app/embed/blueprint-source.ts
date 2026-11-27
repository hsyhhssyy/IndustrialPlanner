import { BLUEPRINT_SCHEMA_VERSION, type BlueprintDocument } from "@/domain/document/blueprint-document";
import { createWorldDocument, type CacheLinkEndpointDefinition, type WorldDocument } from "@/domain/document/world-document";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { BASE_BUILTIN_ENTITY_ID_PREFIX, buildBaseBuiltinEntityId, isBaseBuiltinEntityId, resolveBaseBuiltinEntities } from "@/domain/registry/types/base-definition";
import type { GridPoint, GridRect } from "@/domain/shared/grid";
import { convertGameBlueprint, isGameBlueprint } from "@/shared/game-blueprint";
import { normalizeBlueprintDocument } from "@/shared/blueprints/blueprint-document-codec";
import { MAX_BLUEPRINT_ENTITIES, MAX_BLUEPRINT_GRID_COORDINATE } from "@/shared/blueprints/blueprint-input-limits";
import { resolveEntityGridGeometry } from "@/shared/geometry/entity-grid-geometry";
import { translateRegionRects } from "@/shared/geometry/region-rects";
import { toJS } from "mobx";

interface EmbedLayoutEntry {
  url: string;
  position: GridPoint;
}

export type BlueprintEmbedOptions = (
  | { blueprintUrl: string; layout?: never }
  | { blueprintUrl?: never; layout: readonly EmbedLayoutEntry[] }
) & {
  baseId?: string;
  view: "3d-top" | "blueprint";
  animations: boolean;
  autoplay: boolean;
  showBase: boolean;
  warmupSeconds: number;
};

// 公共样本最大约 182 KiB；限制解压后的响应，避免外部输入无限占用内存。
export const EMBED_BLUEPRINT_MAX_BYTES = 4 * 1024 * 1024;

export function embedError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

export function parseBlueprintEmbedOptions(href: string): BlueprintEmbedOptions {
  const page = new URL(href);
  const params = page.searchParams;
  for (const key of ["embed", "blueprintUrl", "baseId", "view", "animations", "autoplay", "showBase", "warmupSeconds"]) {
    if (params.getAll(key).length > 1) throw embedError("INVALID_PARAMETER", `参数 ${key} 不可重复。`);
  }
  const embed = params.get("embed");
  const source = embed === "blueprint"
    ? { blueprintUrl: resolveEmbedFileUrl(params.get("blueprintUrl"), page) }
    : { layout: parseEmbedLayout(embed, page) };
  const baseId = params.get("baseId");
  if (baseId !== null && !baseId.trim()) throw embedError("INVALID_PARAMETER", "参数 baseId 必须为有效基地 ID。");
  const view = params.get("view") ?? "3d-top";
  if (view !== "3d-top" && view !== "blueprint") throw embedError("INVALID_PARAMETER", "未知的蓝图显示模式。");
  const flag = (key: string, fallback = "0") => {
    const value = params.get(key) ?? fallback;
    if (value !== "0" && value !== "1") throw embedError("INVALID_PARAMETER", `参数 ${key} 必须为 0 或 1。`);
    return value === "1";
  };
  const warmup = params.get("warmupSeconds") ?? "0";
  const warmupSeconds = Number(warmup);
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(warmup) || !Number.isFinite(warmupSeconds)) {
    throw embedError("INVALID_PARAMETER", "参数 warmupSeconds 必须为非负有限秒数。");
  }
  return { ...source, ...(baseId === null ? {} : { baseId }),
    view, animations: flag("animations"), autoplay: flag("autoplay"), showBase: flag("showBase", "1"), warmupSeconds };
}

function parseEmbedLayout(value: string | null, page: URL): EmbedLayoutEntry[] {
  if (page.searchParams.has("blueprintUrl")) {
    throw embedError("INVALID_PARAMETER", "清单模式请通过各条目的 f 指定蓝图文件。");
  }
  let layout: unknown;
  try { layout = JSON.parse(value ?? ""); }
  catch { throw embedError("INVALID_PARAMETER", "参数 embed 须为 blueprint 或有效的蓝图清单 JSON。"); }
  if (!Array.isArray(layout) || layout.length === 0) {
    throw embedError("INVALID_PARAMETER", "蓝图清单必须为非空数组。");
  }
  return layout.map((entry: unknown, index) => {
    if (!record(entry)) throw embedError("INVALID_PARAMETER", `蓝图清单第 ${index + 1} 项须为对象。`);
    const match = typeof entry.p === "string" ? /^(-?\d+)x(-?\d+)$/.exec(entry.p) : null;
    const position = match && { x: Number(match[1]), y: Number(match[2]) };
    if (!position || !point(position)) {
      throw embedError("INVALID_POSITION", `蓝图清单第 ${index + 1} 项的 p 须为两个有效整数格坐标，以小写 x 分隔。`);
    }
    try {
      return { url: resolveEmbedFileUrl(entry.f, page), position };
    } catch (error) {
      throw layoutEntryError(index, null, error);
    }
  });
}

function resolveEmbedFileUrl(source: unknown, page: URL): string {
  if (typeof source !== "string" || !source.trim()) {
    throw embedError("INVALID_PARAMETER", "请提供蓝图文件地址。");
  }
  let url: URL;
  try { url = new URL(source, page); }
  catch { throw embedError("INVALID_PARAMETER", "蓝图文件地址无效。"); }
  const loopback = (value: string) => ["localhost", "127.0.0.1", "[::1]"].includes(value);
  const localDevelopment = page.protocol === "http:" && loopback(page.hostname)
    && url.protocol === "http:" && loopback(url.hostname);
  if ((url.protocol !== "https:" && !localDevelopment) || url.username || url.password || url.href.includes("#")) {
    throw embedError("INVALID_PARAMETER", "蓝图地址须为不含凭据或片段的 HTTPS 文件地址。");
  }
  return url.href;
}

export async function loadEmbedBlueprint(url: string, signal: AbortSignal): Promise<BlueprintDocument> {
  return decodeEmbedBlueprint(await fetchEmbedBlueprintJson(url, signal));
}

async function readEmbedBlueprintFiles(options: BlueprintEmbedOptions, signal: AbortSignal) {
  const nativeBaseIds = new Set<string>();
  const entries = options.layout ?? [{ url: options.blueprintUrl }];
  const decoded = new Map<string, { kind: "game"; value: unknown } | { kind: "native"; blueprint: BlueprintDocument }>();
  for (const [index, entry] of entries.entries()) {
    if (decoded.has(entry.url)) continue;
    try {
      const value = await fetchEmbedBlueprintJson(entry.url, signal);
      if (isGameBlueprint(value)) {
        checkEmbedJson(value);
        decoded.set(entry.url, { kind: "game", value });
      } else {
        const blueprint = decodeEmbedBlueprint(value);
        nativeBaseIds.add(blueprint.baseId);
        decoded.set(entry.url, { kind: "native", blueprint });
      }
    } catch (error) {
      signal.throwIfAborted();
      throw options.layout ? layoutEntryError(index, entry.url, error) : error;
    }
  }

  return { entries, decoded, nativeBaseIds };
}

export async function loadEmbedBlueprintLayout(
  options: BlueprintEmbedOptions,
  registrySource: RegistryContract | Promise<RegistryContract>,
  signal: AbortSignal,
): Promise<BlueprintDocument> {
  const [registry, { entries, decoded, nativeBaseIds }] = await Promise.all([
    Promise.resolve(registrySource).then(registry => {
      if (options.baseId !== undefined && !registry.baseDefinitions.some(base => base.id === options.baseId)) {
        throw embedError("INVALID_PARAMETER", `未知的基地 ID：${options.baseId}。`);
      }
      return registry;
    }),
    readEmbedBlueprintFiles(options, signal),
  ]);
  signal.throwIfAborted();
  if (options.baseId === undefined && nativeBaseIds.size > 1) {
    throw embedError("BASE_CONFLICT", `原生蓝图的基地不同（${[...nativeBaseIds].join("、")}），请显式指定 baseId。`);
  }
  const baseId = options.baseId ?? nativeBaseIds.values().next().value ?? "draft_box";
  const converted = new Map<string, BlueprintDocument>();
  let entityCount = 0;
  const blueprints = entries.map((entry, index) => {
    signal.throwIfAborted();
    try {
      const existing = converted.get(entry.url);
      const source = decoded.get(entry.url)!;
      const blueprint = existing ?? (source.kind === "game"
        ? convertGameBlueprint(source.value, registry, { baseId })
        : rebaseEmbedBlueprint(source.blueprint, baseId));
      if (!existing) {
        validateEmbedRegistryReferences(blueprint, registry);
        converted.set(entry.url, blueprint);
      }
      entityCount += blueprint.entityOrder.length;
      if (entityCount > MAX_BLUEPRINT_ENTITIES) {
        throw embedError("BLUEPRINT_TOO_LARGE", `蓝图最多可展示 ${MAX_BLUEPRINT_ENTITIES} 个实体。`);
      }
      return blueprint;
    } catch (error) {
      const failure = record(error) && typeof error.code === "string" ? error
        : embedError("INVALID_BLUEPRINT", error instanceof Error ? error.message : "蓝图内容无效。");
      throw options.layout ? layoutEntryError(index, entry.url, failure) : failure;
    }
  });
  const [first] = blueprints;
  if (first === undefined) throw embedError("INVALID_PARAMETER", "蓝图清单必须为非空数组。");
  if (!options.layout) return first;

  const layout: BlueprintDocument = {
    ...first, initialGridPoint: { x: 0, y: 0 }, entities: {}, entityOrder: [], slotLinks: [], regions: [],
  };
  const regions: BlueprintDocument["regions"][number][] = [];
  for (const [index, entry] of options.layout.entries()) {
    const blueprint = blueprints[index]!;
    const bounds = resolveEmbedBlueprintBounds(blueprint, registry);
    const offset = { x: entry.position.x - bounds.x, y: entry.position.y - bounds.y };
    const ensurePosition = (position: GridPoint) => {
      if (!point(position)) throw layoutEntryError(index, entry.url,
        embedError("INVALID_POSITION", "蓝图摆放后超出可支持的网格范围。"));
    };
    if (bounds.width > 0 && bounds.height > 0) {
      ensurePosition({ x: entry.position.x + bounds.width - 1, y: entry.position.y + bounds.height - 1 });
    }
    const prefix = `embed-${index + 1}:`;
    for (const id of blueprint.entityOrder) {
      const entity = blueprint.entities[id]!;
      const instanceId = prefix + id;
      layout.entities[instanceId] = {
        ...structuredClone(entity), id: instanceId,
        position: { x: entity.position.x + offset.x, y: entity.position.y + offset.y },
      };
      layout.entityOrder.push(instanceId);
    }
    const remapEndpoint = (endpoint: CacheLinkEndpointDefinition): CacheLinkEndpointDefinition => {
      const { entityId, storageSlotGroupId, slotId } = endpoint;
      return { entityId: isWarehouseEndpoint(entityId) || isBaseBuiltinEntityId(entityId) ? entityId : prefix + entityId,
        storageSlotGroupId, slotId };
    };
    for (const link of blueprint.slotLinks) {
      layout.slotLinks.push({
        ...link, id: prefix + link.id, source: remapEndpoint(link.source), target: remapEndpoint(link.target),
      });
    }
    for (const region of blueprint.regions) {
      for (const rect of region.rects) {
        ensurePosition({ x: rect.x + offset.x, y: rect.y + offset.y });
        ensurePosition({ x: rect.x + rect.width + offset.x - 1, y: rect.y + rect.height + offset.y - 1 });
      }
      regions.push({ ...region, id: prefix + region.id, rects: translateRegionRects(region.rects, offset) });
    }
  }
  const bounds = resolveEmbedBlueprintBounds(layout, registry);
  return { ...layout, regions, initialGridPoint: { x: bounds.x, y: bounds.y } };
}

function rebaseEmbedBlueprint(blueprint: BlueprintDocument, baseId: string): BlueprintDocument {
  if (blueprint.baseId === baseId && !blueprint.slotLinks.some(link =>
    [link.source, link.target].some(endpoint => endpoint.entityId.startsWith("warehouse:"))
  )) return blueprint;

  const oldBuiltinPrefix = `${BASE_BUILTIN_ENTITY_ID_PREFIX}${blueprint.baseId}:`;
  const rebaseEndpoint = (endpoint: CacheLinkEndpointDefinition): CacheLinkEndpointDefinition => {
    const { entityId } = endpoint;
    if (isWarehouseEndpoint(entityId)) return { ...endpoint, entityId: "warehouse" };
    if (entityId.startsWith(oldBuiltinPrefix)) {
      return { ...endpoint, entityId: buildBaseBuiltinEntityId({ baseId, builtinEntityId: entityId.slice(oldBuiltinPrefix.length) }) };
    }
    return endpoint;
  };
  return {
    ...blueprint, baseId,
    slotLinks: blueprint.slotLinks.map(link => ({ ...link, source: rebaseEndpoint(link.source), target: rebaseEndpoint(link.target) })),
  };
}

function layoutEntryError(index: number, url: string | null, error: unknown): Error {
  const code = record(error) && typeof error.code === "string" ? error.code : "LOAD_FAILED";
  const message = error instanceof Error ? error.message : "蓝图加载失败。";
  const fileUrl = url === null ? null : new URL(url);
  const file = fileUrl === null ? "" : `（${fileUrl.origin}${fileUrl.pathname}）`;
  return embedError(code, `蓝图清单第 ${index + 1} 项${file}：${message}`);
}

async function fetchEmbedBlueprintJson(url: string, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  let response: Response;
  try {
    response = await fetch(url, { signal, credentials: "omit", mode: "cors" });
  } catch (error) {
    signal.throwIfAborted();
    throw embedError("LOAD_FAILED", error instanceof Error ? `无法读取蓝图文件：${error.message}` : "无法读取蓝图文件。");
  }
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
  try { return JSON.parse(text) as unknown; }
  catch { throw embedError("INVALID_JSON", "蓝图文件不是有效的 JSON。"); }
}

export function decodeEmbedBlueprint(value: unknown): BlueprintDocument {
  const invalid = () => embedError("INVALID_BLUEPRINT", "蓝图内容无效或超出支持范围。");
  if (!record(value) || !Number.isInteger(value.schemaVersion)) throw invalid();
  if (Number(value.schemaVersion) > BLUEPRINT_SCHEMA_VERSION) {
    throw embedError("UNSUPPORTED_VERSION", "蓝图版本高于当前查看器支持的版本。");
  }
  // 迁移前检查有限数值、嵌套深度与危险对象键，迁移后再核对实体和链接结构。
  checkEmbedJson(value);
  if (!record(value.entities) || Object.keys(value.entities).length > MAX_BLUEPRINT_ENTITIES) throw invalid();
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
        || !(Object.hasOwn(blueprint.entities, endpoint.entityId) || isWarehouseEndpoint(endpoint.entityId)
          || isBaseBuiltinEntityId(endpoint.entityId))) throw invalid();
    }
  }
  return blueprint;
}

function checkEmbedJson(item: unknown, depth = 0): void {
  const invalid = () => embedError("INVALID_BLUEPRINT", "蓝图内容无效或超出支持范围。");
  if (depth > 64 || typeof item === "number" && !Number.isFinite(item)) throw invalid();
  if (item === null || typeof item !== "object") return;
  for (const [key, child] of Object.entries(item)) {
    if (["__proto__", "constructor", "prototype"].includes(key)) throw invalid();
    checkEmbedJson(child, depth + 1);
  }
}

function validateEmbedRegistryReferences(blueprint: BlueprintDocument, registry: RegistryContract): void {
  if (!registry.baseDefinitions.some(base => base.id === blueprint.baseId)) {
    throw embedError("INVALID_BLUEPRINT", "蓝图引用了未知基地。");
  }
  for (const entity of Object.values(blueprint.entities)) {
    if (!registry.queries.findEntityDefinition(entity.definitionId)) {
      throw embedError("INVALID_BLUEPRINT", `蓝图引用了未知设备：${entity.definitionId}`);
    }
  }
  const builtinIds = new Set(resolveBaseBuiltinEntities({ baseDefinitions: registry.baseDefinitions, baseId: blueprint.baseId })
    .map(entity => entity.id));
  for (const link of blueprint.slotLinks) {
    for (const { entityId } of [link.source, link.target]) {
      if (isBaseBuiltinEntityId(entityId) && !builtinIds.has(entityId)) {
        throw embedError("INVALID_BLUEPRINT", `蓝图引用了目标基地中不存在的内建设备：${entityId}`);
      }
    }
  }
}

export function createEmbedWorldDocument(
  blueprint: BlueprintDocument,
  registry: RegistryContract,
  viewport?: { width: number; height: number; gridCellPixelSize: number },
): WorldDocument {
  validateEmbedRegistryReferences(blueprint, registry);
  const document = createWorldDocument({ baseId: blueprint.baseId });
  const bounds = resolveEmbedBlueprintBounds(blueprint, registry);
  return {
    ...document,
    meta: { ...document.meta, name: blueprint.name },
    entities: structuredClone(toJS(blueprint.entities)),
    entityOrder: [...blueprint.entityOrder],
    slotLinks: structuredClone(toJS(blueprint.slotLinks)),
    regions: structuredClone(toJS(blueprint.regions)),
    documentSettings: {
      ...document.documentSettings,
      viewport: {
        ...document.documentSettings.viewport,
        gridSize: viewport ? Math.min(1,
          viewport.width / ((bounds.width + 2) * viewport.gridCellPixelSize),
          viewport.height / ((bounds.height + 2) * viewport.gridCellPixelSize),
        ) : 1,
        center: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
      },
    },
  };
}

export function resolveEmbedBlueprintBounds(blueprint: BlueprintDocument, registry: RegistryContract): GridRect {
  const bounds = resolveEntityGridGeometry({
    entities: Object.values(blueprint.entities),
    entityDefinitionMap: new Map(registry.entityDefinitions.map(definition => [definition.id, definition])),
  })?.boundingBox;
  return bounds ? { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height }
    : { x: 0, y: 0, width: 0, height: 0 };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isWarehouseEndpoint(entityId: string): boolean {
  return entityId === "warehouse" || entityId.startsWith("warehouse:");
}

function point(value: unknown): boolean {
  return record(value) && Number.isSafeInteger(value.x) && Number.isSafeInteger(value.y)
    && Math.abs(Number(value.x)) <= MAX_BLUEPRINT_GRID_COORDINATE
    && Math.abs(Number(value.y)) <= MAX_BLUEPRINT_GRID_COORDINATE;
}
