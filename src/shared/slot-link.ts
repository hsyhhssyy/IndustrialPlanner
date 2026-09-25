import type { CacheLinkEndpointDefinition, SlotLinkDefinition } from "@/domain/shared/slot-link";

/** 端点是否属于当前文档；未提供文档基地时只接受相对端点。 */
export function isLocalSlotLinkEndpoint(endpoint: CacheLinkEndpointDefinition, baseId?: string): boolean {
  return endpoint.baseId === undefined || endpoint.baseId === baseId;
}

export function isLocalSlotLink(link: SlotLinkDefinition, baseId?: string): boolean {
  return isLocalSlotLinkEndpoint(link.source, baseId) && isLocalSlotLinkEndpoint(link.target, baseId);
}
