import { Container, Sprite, Texture } from "pixi.js";

import type { WorldEntity } from "@/domain/document/world-document";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { GridEdge, GridPoint, GridRectSize, GridRotation } from "@/domain/shared/grid";
import type { LogisticsDraftReadonlyState, LogisticsKind, LogisticsPortDirection, LogisticsPortKind } from "@/domain/shared/logistics";
import { getRotatedGridFootprint } from "@/shared/geometry/grid";
import { resolveViewportRectFromWorldGridRect } from "@/shared/geometry/viewport-transform";
import { resolveAppThemeColorNumber } from "@/shared/theme/app-theme-color";

import type { DecorationLayer } from "./DecorationLayer";
import type { DecorationSyncContext } from "./DecorationSyncContext";

type PortGroupDefinition = EntityDefinition["portGroups"][number];
type PortDefinition = PortGroupDefinition["ports"][number];
type PortChevronMaterial = "solid" | "liquid";
type PortChevronDirection = "input" | "output";
type PortChevronTextureKey = `${PortChevronMaterial}-${PortChevronDirection}`;

const DEGREE_TO_RADIAN = Math.PI / 180;
const PORT_CHEVRON_TEXTURE_KEYS = [
  "solid-input",
  "solid-output",
  "liquid-input",
  "liquid-output",
] as const satisfies readonly PortChevronTextureKey[];

export interface PortOverlayEntry {
  readonly entityId: string;
  readonly portGroupId: string;
  readonly portId: string;
  readonly outsideGridPoint: GridPoint;
  readonly edge: GridEdge;
  readonly material: PortChevronMaterial;
  readonly direction: PortChevronDirection;
  readonly state: "chevron" | "cross";
}

interface ResolvedPortEndpoint {
  readonly entityId: string;
  readonly portGroupId: string;
  readonly portId: string;
  readonly insideGridPoint: GridPoint;
  readonly outsideGridPoint: GridPoint;
  readonly edge: GridEdge;
  readonly kind: LogisticsPortKind;
  readonly direction: "input" | "output" | "bidirectional";
  readonly material: PortChevronMaterial;
}

export function resolveLogisticsPortOverlayEntries(options: {
  readonly entities: readonly WorldEntity[];
  readonly entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
  readonly kind: LogisticsKind;
  readonly direction: LogisticsPortDirection;
  readonly occupiedDraftPortKeys?: ReadonlySet<string>;
  readonly basePlaceableArea?: GridRectSize;
}): PortOverlayEntry[] {
  const entries: PortOverlayEntry[] = [];
  const portKind = options.kind === "belt" ? "item" : "fluid";

  for (const entity of options.entities) {
    const definition = options.entityDefinitionMap.get(entity.definitionId);
    if (definition === undefined || definition.tags.includes("ChevronHidden")) {
      continue;
    }

    for (const endpoint of resolveEntityPortEndpoints(entity, definition)) {
      if (options.occupiedDraftPortKeys?.has(resolveEntityPortKey(endpoint))) {
        continue;
      }

      const directionMatches = endpoint.direction === options.direction
        || endpoint.direction === "bidirectional";
      const kindMatches = endpoint.kind === portKind;
      const endpointKind = resolveLogisticsKindForPortKind(endpoint.kind);
      const endpointDirection = endpoint.direction === "bidirectional"
        ? options.direction
        : endpoint.direction;

      if (!canLegallyLeadLogisticsFromPort({
        endpoint,
        kind: endpointKind,
        direction: endpointDirection,
        entities: options.entities,
        entityDefinitionMap: options.entityDefinitionMap,
        basePlaceableArea: endpointKind === "belt"
          ? options.basePlaceableArea
          : undefined,
      })) {
        continue;
      }

      entries.push(toPortOverlayEntry(
        endpoint,
        directionMatches && kindMatches ? "chevron" : "cross",
      ));
    }
  }

  return entries;
}

export function resolveSelectedPortOverlayEntries(options: {
  readonly entities: readonly WorldEntity[];
  readonly selectedEntityIds: ReadonlySet<string>;
  readonly entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
}): PortOverlayEntry[] {
  if (options.selectedEntityIds.size !== 1) {
    return [];
  }

  const selectedId = options.selectedEntityIds.values().next().value as string | undefined;
  const entity = options.entities.find((candidate) => candidate.id === selectedId);
  if (entity === undefined) {
    return [];
  }

  const definition = options.entityDefinitionMap.get(entity.definitionId);
  if (definition === undefined || definition.tags.includes("ChevronHidden")) {
    return [];
  }

  return resolveEntityPortEndpoints(entity, definition).map((endpoint) =>
    toPortOverlayEntry(endpoint, "chevron")
  );
}

export function createPortOverlayDecoration(): DecorationLayer {
  const container = new Container();
  const chevronSprites: Sprite[] = [];
  const crossSprites: Sprite[] = [];
  const chevronTextures = new Map<PortChevronTextureKey, Texture>();
  let crossTexture: Texture | null = null;
  let textureVariant: "desktop" | "mobile" | null = null;
  let textureLoadVersion = 0;

  const hideSprites = (): void => {
    for (const sprite of chevronSprites) sprite.visible = false;
    for (const sprite of crossSprites) sprite.visible = false;
  };

  const ensureTextures = (ctx: DecorationSyncContext, useMobile: boolean): boolean => {
    const nextVariant = useMobile ? "mobile" : "desktop";
    if (
      textureVariant === nextVariant
      && chevronTextures.size === PORT_CHEVRON_TEXTURE_KEYS.length
      && crossTexture !== null
    ) {
      return true;
    }

    if (textureVariant === nextVariant) {
      return false;
    }

    textureVariant = nextVariant;
    chevronTextures.clear();
    crossTexture = null;
    hideSprites();
    textureLoadVersion += 1;
    const activeLoadVersion = textureLoadVersion;
    const suffix = useMobile ? "-mobile" : "";

    void Promise.all([
      ...PORT_CHEVRON_TEXTURE_KEYS.map(async (key) => {
        const [material, direction] = key.split("-");
        const texture = await ctx.renderHost.textureManager.getTexture(
          `texture-${material}-port-chevron-${direction}${suffix}`,
        );
        return [key, texture] as const;
      }),
      ctx.renderHost.textureManager.getTexture(`texture-port-cross${suffix}`),
    ]).then((loaded) => {
      if (activeLoadVersion !== textureLoadVersion) {
        return;
      }

      for (let index = 0; index < PORT_CHEVRON_TEXTURE_KEYS.length; index += 1) {
        const entry = loaded[index] as readonly [PortChevronTextureKey, Texture] | undefined;
        if (entry !== undefined) {
          chevronTextures.set(entry[0], entry[1]);
        }
      }
      crossTexture = loaded[PORT_CHEVRON_TEXTURE_KEYS.length] as Texture;
    }).catch(() => {
      // texture manager 自带 fallback；异步异常不应中断 renderer ticker。
    });

    return false;
  };

  return {
    container,
    sync(ctx): void {
      hideSprites();

      const editor = ctx.renderHost.workspace.editor;
      const app = ctx.renderHost.workspace.app;
      if (editor === null || app === null) {
        return;
      }

      const entities = editor.queries.listEntities();
      const entityDefinitionMap = new Map(
        ctx.renderHost.workspace.registry.entityDefinitions.map((definition) => [
          definition.id,
          definition,
        ]),
      );
      const logisticsKind = resolveActiveLogisticsKind(ctx);
      const draft = editor.queries.resolveLogisticsDraftState();
      let entries: PortOverlayEntry[];

      if (app.state.activeTool === "logistics-placement" && logisticsKind !== null) {
        const direction: LogisticsPortDirection = draft !== null
          && draft.headDraftEntityId !== null
          ? "input"
          : "output";
        const currentBase = ctx.renderHost.workspace.registry.baseDefinitions.find(
          (definition) => definition.id === editor.document.getSnapshot().baseId,
        );
        entries = resolveLogisticsPortOverlayEntries({
          entities,
          entityDefinitionMap,
          kind: logisticsKind,
          direction,
          occupiedDraftPortKeys: resolveOccupiedDraftPortKeys(draft),
          basePlaceableArea: currentBase?.placeableArea,
        });
      } else {
        entries = resolveSelectedPortOverlayEntries({
          entities,
          selectedEntityIds: resolveSingleSelectedOrPreviewEntityIds(ctx),
          entityDefinitionMap,
        });
      }

      const useMobile = app.state.screenProfile.deviceClass === "mobile"
        || app.state.screenProfile.deviceClass === "tablet";

      if (useMobile) {
        entries = deduplicateEntriesByGridCell(entries);
      }

      if (entries.length === 0) {
        return;
      }
      if (!ensureTextures(ctx, useMobile)) {
        return;
      }

      let chevronIndex = 0;
      let crossIndex = 0;
      for (const entry of entries) {
        const layout = resolvePortEntryViewportLayout(ctx, entry);
        if (layout === null) {
          continue;
        }

        if (entry.state === "cross") {
          if (crossTexture === null) continue;
          const sprite = getOrCreateSprite(crossSprites, crossIndex, container);
          crossIndex += 1;
          sprite.texture = crossTexture;
          // AI-CORRECTION 2026-06-18: 实机端口叉号使用高亮橙红色而非纯红色，配合贴图中的 alpha 柔光还原发光标记。
          sprite.tint = 0xff4b24;
          applyPortSpriteLayout(sprite, layout);
          continue;
        }

        const texture = chevronTextures.get(`${entry.material}-${entry.direction}`);
        if (texture === undefined) continue;
        const sprite = getOrCreateSprite(chevronSprites, chevronIndex, container);
        chevronIndex += 1;
        sprite.texture = texture;
        sprite.tint = resolveAppThemeColorNumber(
          ctx.theme,
          ctx.theme.renderer.portChevronColorKey,
        );
        applyPortSpriteLayout(sprite, layout);
      }
    },
    destroy(): void {
      textureLoadVersion += 1;
      container.destroy({ children: true });
    },
  };
}

function canLegallyLeadLogisticsFromPort(options: {
  endpoint: ResolvedPortEndpoint;
  kind: LogisticsKind;
  direction: LogisticsPortDirection;
  entities: readonly WorldEntity[];
  entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
  basePlaceableArea?: GridRectSize;
}): boolean {
  const point = options.endpoint.outsideGridPoint;
  if (
    options.basePlaceableArea !== undefined
    && (
      point.x < 0
      || point.y < 0
      || point.x >= options.basePlaceableArea.width
      || point.y >= options.basePlaceableArea.height
    )
  ) {
    return false;
  }

  const occupants = findEntitiesAtGridPoint({
    gridPoint: point,
    entities: options.entities,
    entityDefinitionMap: options.entityDefinitionMap,
  }).filter((entity) => entity.id !== options.endpoint.entityId);
  if (occupants.length === 0) {
    return true;
  }

  const sameFamilyOccupant = occupants.find((entity) => {
    const definition = options.entityDefinitionMap.get(entity.definitionId);
    return definition !== undefined && isDefinitionForLogisticsKind(definition, options.kind);
  });
  if (sameFamilyOccupant === undefined) {
    return occupants.every((entity) => {
      const definition = options.entityDefinitionMap.get(entity.definitionId);
      return definition !== undefined
        && isOppositeDedicatedLogisticsDefinition(definition, options.kind);
    });
  }

  const neighborDefinition = options.entityDefinitionMap.get(sameFamilyOccupant.definitionId);
  if (neighborDefinition === undefined) {
    return false;
  }

  if (hasFacingConnectedPort({
    sourceEndpoint: options.endpoint,
    neighbor: sameFamilyOccupant,
    neighborDefinition,
    kind: options.kind,
    direction: options.direction,
  })) {
    return false;
  }

  if (!isOrdinaryLogisticsDefinition(neighborDefinition, options.kind)) {
    return false;
  }

  const neighborAxis = resolveOrdinaryLogisticsAxis({
    entity: sameFamilyOccupant,
    definition: neighborDefinition,
    kind: options.kind,
  });
  if (neighborAxis === null || neighborAxis === resolveEdgeAxis(options.endpoint.edge)) {
    return false;
  }

  return hasAnyConnectedOrdinaryLogisticsPort({
    entity: sameFamilyOccupant,
    definition: neighborDefinition,
    kind: options.kind,
    entities: options.entities,
    entityDefinitionMap: options.entityDefinitionMap,
  });
}

function hasFacingConnectedPort(options: {
  sourceEndpoint: ResolvedPortEndpoint;
  neighbor: WorldEntity;
  neighborDefinition: EntityDefinition;
  kind: LogisticsKind;
  direction: LogisticsPortDirection;
}): boolean {
  const expectedDirection = options.direction === "output" ? "input" : "output";
  const portKind = options.kind === "belt" ? "item" : "fluid";
  return resolveEntityPortEndpoints(options.neighbor, options.neighborDefinition).some((endpoint) =>
    endpoint.kind === portKind
    && (endpoint.direction === expectedDirection || endpoint.direction === "bidirectional")
    && pointsEqual(endpoint.outsideGridPoint, options.sourceEndpoint.insideGridPoint)
  );
}

function hasAnyConnectedOrdinaryLogisticsPort(options: {
  entity: WorldEntity;
  definition: EntityDefinition;
  kind: LogisticsKind;
  entities: readonly WorldEntity[];
  entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
}): boolean {
  const portKind = options.kind === "belt" ? "item" : "fluid";
  return resolveEntityPortEndpoints(options.entity, options.definition).some((endpoint) => {
    if (endpoint.kind !== portKind) return false;
    const expectedDirection = endpoint.direction === "input" ? "output" : "input";
    return findEntitiesAtGridPoint({
      gridPoint: endpoint.outsideGridPoint,
      entities: options.entities,
      entityDefinitionMap: options.entityDefinitionMap,
    }).some((neighbor) => {
      if (neighbor.id === options.entity.id) return false;
      const definition = options.entityDefinitionMap.get(neighbor.definitionId);
      return definition !== undefined
        && resolveEntityPortEndpoints(neighbor, definition).some((neighborEndpoint) =>
          neighborEndpoint.kind === portKind
          && (
            neighborEndpoint.direction === expectedDirection
            || neighborEndpoint.direction === "bidirectional"
          )
          && pointsEqual(neighborEndpoint.outsideGridPoint, endpoint.insideGridPoint)
        );
    });
  });
}

function resolveOrdinaryLogisticsAxis(options: {
  entity: WorldEntity;
  definition: EntityDefinition;
  kind: LogisticsKind;
}): "horizontal" | "vertical" | null {
  const portKind = options.kind === "belt" ? "item" : "fluid";
  const axes = new Set(
    resolveEntityPortEndpoints(options.entity, options.definition)
      .filter((endpoint) => endpoint.kind === portKind)
      .map((endpoint) => resolveEdgeAxis(endpoint.edge)),
  );
  return axes.size === 1 ? axes.values().next().value ?? null : null;
}

function resolveEntityPortEndpoints(
  entity: WorldEntity,
  definition: EntityDefinition,
): ResolvedPortEndpoint[] {
  const endpoints: ResolvedPortEndpoint[] = [];
  for (const portGroup of definition.portGroups) {
    const material = resolvePortChevronMaterial(definition, portGroup);
    for (const port of portGroup.ports) {
      const localCell = rotateLocalPortCell({
        footprint: definition.footprint,
        port,
        rotation: entity.rotation,
      });
      const edge = rotateGridEdge(port.edge, entity.rotation);
      const insideGridPoint = {
        x: entity.position.x + localCell.x,
        y: entity.position.y + localCell.y,
      };
      const delta = resolveEdgeDelta(edge);
      endpoints.push({
        entityId: entity.id,
        portGroupId: portGroup.id,
        portId: port.id,
        insideGridPoint,
        outsideGridPoint: {
          x: insideGridPoint.x + delta.x,
          y: insideGridPoint.y + delta.y,
        },
        edge,
        kind: portGroup.kind,
        direction: portGroup.direction,
        material,
      });
    }
  }
  return endpoints;
}

function findEntitiesAtGridPoint(options: {
  gridPoint: GridPoint;
  entities: readonly WorldEntity[];
  entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
}): WorldEntity[] {
  return options.entities.filter((entity) => {
    const definition = options.entityDefinitionMap.get(entity.definitionId);
    if (definition === undefined) return false;
    const footprint = getRotatedGridFootprint(definition.footprint, entity.rotation);
    return options.gridPoint.x >= entity.position.x
      && options.gridPoint.x < entity.position.x + footprint.width
      && options.gridPoint.y >= entity.position.y
      && options.gridPoint.y < entity.position.y + footprint.height;
  });
}

function isDefinitionForLogisticsKind(definition: EntityDefinition, kind: LogisticsKind): boolean {
  return definition.tags.includes(kind === "belt" ? "BeltFamily" : "PipeFamily");
}

function isOppositeDedicatedLogisticsDefinition(
  definition: EntityDefinition,
  kind: LogisticsKind,
): boolean {
  return definition.tags.includes(kind === "belt" ? "PipeFamily" : "BeltFamily");
}

function isOrdinaryLogisticsDefinition(
  definition: EntityDefinition,
  kind: LogisticsKind,
): boolean {
  const prefix = kind === "belt" ? "belt_" : "pipe_";
  return definition.id === `${prefix}straight_1x1`
    || definition.id === `${prefix}turn_cw_1x1`
    || definition.id === `${prefix}turn_ccw_1x1`;
}

function resolveSingleSelectedOrPreviewEntityIds(ctx: DecorationSyncContext): ReadonlySet<string> {
  const collections = ctx.renderHost.workspace.editor?.state.collections;
  if (collections === undefined) return new Set();
  const preview = collections[EntityCollectionType.preview];
  if (preview.length === 1) return new Set(preview);
  const selection = collections[EntityCollectionType.selection];
  return selection.length === 1 ? new Set(selection) : new Set();
}

function resolveActiveLogisticsKind(ctx: DecorationSyncContext): LogisticsKind | null {
  const draft = ctx.renderHost.workspace.editor?.queries.resolveLogisticsDraftState();
  if (draft !== null && draft !== undefined) return draft.kind;
  const app = ctx.renderHost.workspace.app;
  if (app === null || !("internalState" in app)) return null;
  return (
    app as unknown as {
      internalState: {
        runtime: {
          logisticsPlacement: {
            kind: LogisticsKind | null;
          };
        };
      };
    }
  ).internalState.runtime.logisticsPlacement.kind;
}

function resolveOccupiedDraftPortKeys(
  draft: LogisticsDraftReadonlyState | null,
): ReadonlySet<string> {
  if (draft === null || draft.headDraftEntityId === null) return new Set();
  const keys = new Set<string>();
  if (draft.source?.type === "device-port") {
    keys.add(`${draft.source.entityId}:${draft.source.portGroupId}:${draft.source.portId}`);
  }
  if (draft.target?.type === "device-port") {
    keys.add(`${draft.target.entityId}:${draft.target.portGroupId}:${draft.target.portId}`);
  }
  return keys;
}

function resolveEntityPortKey(endpoint: ResolvedPortEndpoint): string {
  return `${endpoint.entityId}:${endpoint.portGroupId}:${endpoint.portId}`;
}

function resolveLogisticsKindForPortKind(kind: LogisticsPortKind): LogisticsKind {
  return kind === "item" ? "belt" : "pipe";
}

/**
 * 触控模式端口去重（同一 grid cell 内）：
 * - 若存在箭头 → 过滤所有叉号，保留全部箭头
 * - 若全是叉号 → 只保留一个
 */
export function deduplicateEntriesByGridCell(
  entries: readonly PortOverlayEntry[],
): PortOverlayEntry[] {
  const groups = new Map<string, PortOverlayEntry[]>();
  for (const entry of entries) {
    const key = `${entry.outsideGridPoint.x},${entry.outsideGridPoint.y}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [entry]);
    } else {
      group.push(entry);
    }
  }

  const result: PortOverlayEntry[] = [];
  for (const group of groups.values()) {
    const chevrons = group.filter((entry) => entry.state === "chevron");
    if (chevrons.length > 0) {
      result.push(...chevrons);
    } else {
      // 全是叉号，只保留第一个
      result.push(group[0]!);
    }
  }
  return result;
}

function toPortOverlayEntry(
  endpoint: ResolvedPortEndpoint,
  state: PortOverlayEntry["state"],
): PortOverlayEntry {
  return {
    entityId: endpoint.entityId,
    portGroupId: endpoint.portGroupId,
    portId: endpoint.portId,
    outsideGridPoint: endpoint.outsideGridPoint,
    edge: endpoint.edge,
    material: endpoint.material,
    direction: endpoint.direction === "output" ? "output" : "input",
    state,
  };
}

function resolvePortEntryViewportLayout(
  ctx: DecorationSyncContext,
  entry: PortOverlayEntry,
): { x: number; y: number; width: number; height: number; rotation: number } | null {
  const rect = resolveViewportRectFromWorldGridRect({
    gridRect: {
      x: entry.outsideGridPoint.x,
      y: entry.outsideGridPoint.y,
      width: 1,
      height: 1,
    },
    viewportBounds: ctx.viewportBounds,
    viewportCenter: {
      x: ctx.viewportState.centerX,
      y: ctx.viewportState.centerY,
    },
    gridCellPixelSize: ctx.viewportState.gridCellPixelSize,
    displayRotation: ctx.viewportState.displayRotation,
  });
  if (rect === null) return null;
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    width: rect.width,
    height: rect.height,
    rotation: resolvePortChevronRotation(
      rotateGridEdge(entry.edge, ctx.viewportState.displayRotation),
    ),
  };
}

function applyPortSpriteLayout(
  sprite: Sprite,
  layout: { x: number; y: number; width: number; height: number; rotation: number },
): void {
  sprite.visible = true;
  sprite.x = layout.x;
  sprite.y = layout.y;
  sprite.width = layout.width;
  sprite.height = layout.height;
  sprite.rotation = layout.rotation;
}

function getOrCreateSprite(
  sprites: Sprite[],
  index: number,
  container: Container,
): Sprite {
  const existing = sprites[index];
  if (existing !== undefined) return existing;
  const sprite = new Sprite(Texture.EMPTY);
  sprite.anchor.set(0.5);
  sprite.roundPixels = true;
  sprite.visible = false;
  container.addChild(sprite);
  sprites[index] = sprite;
  return sprite;
}

function resolvePortChevronMaterial(
  definition: EntityDefinition,
  portGroup: PortGroupDefinition,
): PortChevronMaterial {
  if (portGroup.kind === "fluid") return "liquid";
  const storageSlotGroupById = new Map(
    definition.storageSlotGroups.map((slotGroup) => [slotGroup.id, slotGroup]),
  );
  for (const binding of definition.portStorageBindings) {
    if (binding.portGroupId !== portGroup.id) continue;
    const storageSlotGroup = storageSlotGroupById.get(binding.storageSlotGroupId);
    if (
      storageSlotGroup?.kind === "fluid"
      || storageSlotGroup?.slots.some((slot) => isFluidSlotFilter(slot.itemFilterType))
    ) {
      return "liquid";
    }
  }
  return "solid";
}

function isFluidSlotFilter(
  itemFilterType: EntityDefinition["storageSlotGroups"][number]["slots"][number]["itemFilterType"],
): boolean {
  return itemFilterType === "liquid"
    || itemFilterType === "gas"
    || itemFilterType === "fluid";
}

function rotateLocalPortCell(options: {
  footprint: GridRectSize;
  port: PortDefinition;
  rotation: GridRotation;
}): GridPoint {
  const { width, height } = options.footprint;
  const { localCellX: x, localCellY: y } = options.port;
  switch (options.rotation) {
    case 0: return { x, y };
    case 90: return { x: height - 1 - y, y: x };
    case 180: return { x: width - 1 - x, y: height - 1 - y };
    case 270: return { x: y, y: width - 1 - x };
  }
}

function rotateGridEdge(edge: GridEdge, rotation: GridRotation): GridEdge {
  const edges: readonly GridEdge[] = ["NORTH", "EAST", "SOUTH", "WEST"];
  const index = edges.indexOf(edge);
  return edges[(index + rotation / 90) % edges.length] ?? edge;
}

function resolveEdgeDelta(edge: GridEdge): GridPoint {
  switch (edge) {
    case "NORTH": return { x: 0, y: -1 };
    case "EAST": return { x: 1, y: 0 };
    case "SOUTH": return { x: 0, y: 1 };
    case "WEST": return { x: -1, y: 0 };
  }
}

function resolveEdgeAxis(edge: GridEdge): "horizontal" | "vertical" {
  return edge === "EAST" || edge === "WEST" ? "horizontal" : "vertical";
}

function resolvePortChevronRotation(edge: GridEdge): number {
  switch (edge) {
    case "NORTH": return 0;
    case "EAST": return 90 * DEGREE_TO_RADIAN;
    case "SOUTH": return 180 * DEGREE_TO_RADIAN;
    case "WEST": return 270 * DEGREE_TO_RADIAN;
  }
}

function pointsEqual(left: GridPoint, right: GridPoint): boolean {
  return left.x === right.x && left.y === right.y;
}
