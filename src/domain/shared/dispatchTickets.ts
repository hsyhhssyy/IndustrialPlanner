import type { ItemDef } from '../types'

const DISPATCH_TICKET_REGION_PREFIX = '调度券地区:'
const DISPATCH_TICKET_VALUE_PREFIX = '调度券价值:'

export type DispatchTicketInfo = {
  region: string
  value: number
}

export function getDispatchTicketInfo(item: ItemDef | undefined): DispatchTicketInfo | null {
  if (!item?.tags?.length) return null

  let region = ''
  let value = 0

  for (const tag of item.tags) {
    if (tag.startsWith(DISPATCH_TICKET_REGION_PREFIX)) {
      region = tag.slice(DISPATCH_TICKET_REGION_PREFIX.length)
      continue
    }

    if (tag.startsWith(DISPATCH_TICKET_VALUE_PREFIX)) {
      const parsed = Number.parseFloat(tag.slice(DISPATCH_TICKET_VALUE_PREFIX.length))
      if (Number.isFinite(parsed)) value = Math.max(0, parsed)
    }
  }

  if (!region) return null
  return { region, value }
}