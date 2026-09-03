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
  public readonly componentItemIndexes: Int32Array;
  public readonly deviceFlags: Uint8Array;
  public readonly routingCursors: Uint32Array;
  public readonly activeDeviceIndexes: DenseIndexSet;
  public readonly dirtySlotIndexes: DenseIndexSet;
  public readonly dirtyDeviceIndexes: DenseIndexSet;
  public readonly dirtyComponentIndexes: DenseIndexSet;
  public readonly dirtyRoutingCursorIndexes: DenseIndexSet;
  private readonly lookup: DenseTopologyLookup;

  public constructor(public readonly topology: DenseTopologyLayout) {
    this.lookup = createDenseTopologyLookup(topology.dictionary);
    this.slotItemIndexes = topology.slotInitialItemIndexes.slice();
    this.slotCounts = topology.slotInitialCounts.slice();
    this.slotReserved = new Float64Array(topology.dictionary.slotIds.length);
    this.slotFlags = topology.slotInitialFlags.slice();
    this.componentItemIndexes = new Int32Array(topology.dictionary.componentIds.length);
    this.componentItemIndexes.fill(DENSE_INDEX_NONE);
    this.deviceFlags = new Uint8Array(topology.dictionary.deviceIds.length);
    this.routingCursors = new Uint32Array(topology.dictionary.routingCursorKeys.length);
    this.activeDeviceIndexes = new DenseIndexSet(topology.dictionary.deviceIds.length);
    this.dirtySlotIndexes = new DenseIndexSet(topology.dictionary.slotIds.length);
    this.dirtyDeviceIndexes = new DenseIndexSet(topology.dictionary.deviceIds.length);
    this.dirtyComponentIndexes = new DenseIndexSet(topology.dictionary.componentIds.length);
    this.dirtyRoutingCursorIndexes = new DenseIndexSet(
      topology.dictionary.routingCursorKeys.length,
    );
  }

  public readSlot(slotIndex: number): {
    readonly itemIndex: number;
    readonly count: number;
    readonly reserved: number;
    readonly ignoreStock: boolean;
  } {
    this.assertSlotIndex(slotIndex);
    const storageSlotIndex = this.topology.slotStorageIndexes[slotIndex]!;
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
    const storageSlotIndex = this.topology.slotStorageIndexes[slotIndex]!;
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
    this.dirtyDeviceIndexes.clear();
    this.dirtyComponentIndexes.clear();
    this.dirtyRoutingCursorIndexes.clear();
  }

  public setDeviceBlocked(deviceIndex: number, blocked: boolean): void {
    const next = blocked ? 1 : 0;
    if (this.deviceFlags[deviceIndex] === next) {
      return;
    }
    this.deviceFlags[deviceIndex] = next;
    this.dirtyDeviceIndexes.add(deviceIndex);
  }

  public adjustReserved(slotIndex: number, amount: number): void {
    this.assertSlotIndex(slotIndex);
    if (!Number.isFinite(amount)) {
      throw new Error("Dense reserved adjustment must be finite.");
    }
    const storageIndex = this.topology.slotStorageIndexes[slotIndex]!;
    const next = this.slotReserved[storageIndex]! + amount;
    if (next < 0 || next > this.slotCounts[storageIndex]!) {
      throw new Error(`Dense reserved amount ${next} is invalid for slot ${slotIndex}.`);
    }
    if (next === this.slotReserved[storageIndex]) {
      return;
    }
    this.slotReserved[storageIndex] = next;
    this.markSlotChanged(slotIndex, storageIndex);
  }

  public consume(
    slotIndex: number,
    itemIndex: number,
    amount: number,
    ignoreStock: boolean,
  ): void {
    this.assertSlotIndex(slotIndex);
    this.assertItemIndex(itemIndex);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error("Dense consumed amount must be finite and non-negative.");
    }
    if (ignoreStock || amount === 0) {
      return;
    }
    const storageIndex = this.topology.slotStorageIndexes[slotIndex]!;
    if (
      this.slotItemIndexes[storageIndex] !== itemIndex
      || this.slotCounts[storageIndex]! < amount
    ) {
      throw new Error(`Dense slot ${slotIndex} cannot consume ${amount} of item ${itemIndex}.`);
    }
    const next = this.slotCounts[storageIndex]! - amount;
    this.slotCounts[storageIndex] = next;
    if (next === 0) {
      this.slotItemIndexes[storageIndex] = DENSE_INDEX_NONE;
    }
    this.markSlotChanged(slotIndex, storageIndex);
  }

  public produce(slotIndex: number, itemIndex: number, amount: number): void {
    this.assertSlotIndex(slotIndex);
    this.assertItemIndex(itemIndex);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error("Dense produced amount must be finite and non-negative.");
    }
    if (amount === 0) {
      return;
    }
    const storageIndex = this.topology.slotStorageIndexes[slotIndex]!;
    const currentItemIndex = this.slotItemIndexes[storageIndex]!;
    if (currentItemIndex !== DENSE_INDEX_NONE && currentItemIndex !== itemIndex) {
      throw new Error(`Dense slot ${slotIndex} cannot mix item ${itemIndex}.`);
    }
    this.slotItemIndexes[storageIndex] = itemIndex;
    this.slotCounts[storageIndex] = this.slotCounts[storageIndex]! + amount;
    this.markSlotChanged(slotIndex, storageIndex);
  }

  public tryMoveOne(
    sourceSlotIndex: number,
    targetSlotIndex: number,
    itemIndex: number,
  ): boolean {
    this.assertSlotIndex(sourceSlotIndex);
    this.assertSlotIndex(targetSlotIndex);
    this.assertItemIndex(itemIndex);
    if (itemIndex === DENSE_INDEX_NONE) {
      return false;
    }

    const sourceStorageIndex = this.topology.slotStorageIndexes[sourceSlotIndex]!;
    const targetStorageIndex = this.topology.slotStorageIndexes[targetSlotIndex]!;
    if (sourceStorageIndex === targetStorageIndex) {
      return false;
    }

    const sourceItemIndex = this.slotItemIndexes[sourceStorageIndex]!;
    const sourceIgnoreStock = (this.slotFlags[sourceSlotIndex]! & SLOT_FLAG_IGNORE_STOCK) !== 0;
    if (
      sourceItemIndex !== itemIndex
      || (!sourceIgnoreStock
        && this.slotCounts[sourceStorageIndex]! - this.slotReserved[sourceStorageIndex]! <= 0)
    ) {
      return false;
    }

    const targetItemIndex = this.slotItemIndexes[targetStorageIndex]!;
    const targetLockIndex = this.topology.slotLockItemIndexes[targetSlotIndex]!;
    const targetDomainFlags = this.topology.slotDomainFlags[targetSlotIndex]!;
    const itemDomainFlags = this.topology.itemDomainFlags[itemIndex]!;
    if (
      (targetLockIndex !== DENSE_INDEX_NONE && targetLockIndex !== itemIndex)
      || (targetDomainFlags & itemDomainFlags) === 0
      || (targetItemIndex !== DENSE_INDEX_NONE && targetItemIndex !== itemIndex)
      || this.slotCounts[targetStorageIndex]! >= this.topology.slotCapacities[targetSlotIndex]!
    ) {
      return false;
    }

    if (!sourceIgnoreStock) {
      const nextSourceCount = Math.max(0, this.slotCounts[sourceStorageIndex]! - 1);
      this.slotCounts[sourceStorageIndex] = nextSourceCount;
      if (nextSourceCount === 0) {
        this.slotItemIndexes[sourceStorageIndex] = DENSE_INDEX_NONE;
      }
      this.markSlotChanged(sourceSlotIndex, sourceStorageIndex);
    }

    this.slotItemIndexes[targetStorageIndex] = itemIndex;
    this.slotCounts[targetStorageIndex] = this.slotCounts[targetStorageIndex]! + 1;
    this.markSlotChanged(targetSlotIndex, targetStorageIndex);
    return true;
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

  private markSlotChanged(viewSlotIndex: number, storageSlotIndex: number): void {
    this.dirtySlotIndexes.add(storageSlotIndex);
    const nodeIndex = this.topology.slotNodeIndexes[viewSlotIndex]!;
    this.activeDeviceIndexes.add(this.topology.nodeDeviceIndexes[nodeIndex]!);
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
