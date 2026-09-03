import { DenseIndexSet } from "./dense-index-set";
import {
  DENSE_INDEX_NONE,
  type DenseTopologyLayout,
  type DenseTopologyLookup,
  createDenseTopologyLookup,
} from "./dense-topology";

const SLOT_FLAG_IGNORE_STOCK = 1;

export class DenseRuntimeState {
  public readonly slotItemIndexes: Int32Array;
  public readonly slotCounts: Float64Array;
  public readonly slotReserved: Float64Array;
  public readonly slotFlags: Uint8Array;
  public readonly activeDeviceIndexes: DenseIndexSet;
  public readonly dirtySlotIndexes: DenseIndexSet;
  public readonly dirtyComponentIndexes: DenseIndexSet;
  private readonly lookup: DenseTopologyLookup;

  public constructor(public readonly topology: DenseTopologyLayout) {
    this.lookup = createDenseTopologyLookup(topology.dictionary);
    this.slotItemIndexes = topology.slotInitialItemIndexes.slice();
    this.slotCounts = topology.slotInitialCounts.slice();
    this.slotReserved = new Float64Array(topology.dictionary.slotIds.length);
    this.slotFlags = topology.slotInitialFlags.slice();
    this.activeDeviceIndexes = new DenseIndexSet(topology.dictionary.deviceIds.length);
    this.dirtySlotIndexes = new DenseIndexSet(topology.dictionary.slotIds.length);
    this.dirtyComponentIndexes = new DenseIndexSet(topology.dictionary.componentIds.length);
  }

  public readSlot(slotIndex: number): {
    readonly itemIndex: number;
    readonly count: number;
    readonly reserved: number;
    readonly ignoreStock: boolean;
  } {
    this.assertSlotIndex(slotIndex);
    const storageSlotIndex = this.resolveStorageSlotIndex(slotIndex);
    return {
      itemIndex: this.slotItemIndexes[storageSlotIndex]!,
      count: this.slotCounts[storageSlotIndex]!,
      reserved: this.slotReserved[storageSlotIndex]!,
      ignoreStock: (this.slotFlags[slotIndex]! & SLOT_FLAG_IGNORE_STOCK) !== 0,
    };
  }

  public writeSlot(
    slotIndex: number,
    value: {
      readonly itemIndex: number;
      readonly count: number;
      readonly reserved: number;
      readonly ignoreStock: boolean;
    },
  ): boolean {
    this.assertSlotIndex(slotIndex);
    this.assertItemIndex(value.itemIndex);
    const storageSlotIndex = this.resolveStorageSlotIndex(slotIndex);
    if (
      !Number.isFinite(value.count)
      || value.count < 0
      || !Number.isFinite(value.reserved)
      || value.reserved < 0
    ) {
      throw new Error("Dense slot count and reserved amount must be finite and non-negative.");
    }

    const flags = value.ignoreStock ? SLOT_FLAG_IGNORE_STOCK : 0;
    if (
      this.slotItemIndexes[storageSlotIndex] === value.itemIndex
      && this.slotCounts[storageSlotIndex] === value.count
      && this.slotReserved[storageSlotIndex] === value.reserved
      && this.slotFlags[slotIndex] === flags
    ) {
      return false;
    }

    this.slotItemIndexes[storageSlotIndex] = value.itemIndex;
    this.slotCounts[storageSlotIndex] = value.count;
    this.slotReserved[storageSlotIndex] = value.reserved;
    this.slotFlags[slotIndex] = flags;
    this.dirtySlotIndexes.add(storageSlotIndex);

    const nodeIndex = this.topology.slotNodeIndexes[slotIndex]!;
    const deviceIndex = this.topology.nodeDeviceIndexes[nodeIndex]!;
    this.activeDeviceIndexes.add(deviceIndex);
    return true;
  }

  public writeSlotById(
    slotId: string,
    value: {
      readonly itemId: string | null;
      readonly count: number;
      readonly reserved: number;
      readonly ignoreStock: boolean;
    },
  ): boolean {
    const slotIndex = this.lookup.slotIndexById.get(slotId);
    if (slotIndex === undefined) {
      throw new Error(`Dense runtime cannot resolve slot id "${slotId}".`);
    }
    const itemIndex = value.itemId === null
      ? DENSE_INDEX_NONE
      : this.lookup.itemIndexById.get(value.itemId);
    if (itemIndex === undefined) {
      throw new Error(`Dense runtime cannot resolve item id "${value.itemId}".`);
    }
    return this.writeSlot(slotIndex, {
      itemIndex,
      count: value.count,
      reserved: value.reserved,
      ignoreStock: value.ignoreStock,
    });
  }

  public clearDirtyState(): void {
    this.activeDeviceIndexes.clear();
    this.dirtySlotIndexes.clear();
    this.dirtyComponentIndexes.clear();
  }

  private assertSlotIndex(index: number): void {
    if (
      !Number.isSafeInteger(index)
      || index < 0
      || index >= this.topology.dictionary.slotIds.length
    ) {
      throw new Error(`Dense slot index ${index} is outside the topology.`);
    }
  }

  private resolveStorageSlotIndex(slotIndex: number): number {
    let current = slotIndex;
    for (let depth = 0; depth <= this.topology.slotCanonicalIndexes.length; depth += 1) {
      const next = this.topology.slotCanonicalIndexes[current]!;
      if (next === current) {
        return current;
      }
      current = next;
    }
    throw new Error(`Dense slot alias cycle starts at index ${slotIndex}.`);
  }

  private assertItemIndex(index: number): void {
    if (
      index !== DENSE_INDEX_NONE
      && (
        !Number.isSafeInteger(index)
        || index < 0
        || index >= this.topology.dictionary.itemIds.length
      )
    ) {
      throw new Error(`Dense item index ${index} is outside the topology dictionary.`);
    }
  }
}
