export class DenseIndexSet {
  private readonly bits: Uint32Array;
  private readonly indexes: Uint32Array;
  private length = 0;

  public constructor(public readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 0) {
      throw new Error(`DenseIndexSet capacity must be a non-negative safe integer, received ${capacity}.`);
    }
    this.bits = new Uint32Array(Math.ceil(capacity / 32));
    this.indexes = new Uint32Array(capacity);
  }

  public get size(): number {
    return this.length;
  }

  public has(index: number): boolean {
    this.assertIndex(index);
    const wordIndex = index >>> 5;
    const mask = 1 << (index & 31);
    return (this.bits[wordIndex]! & mask) !== 0;
  }

  public add(index: number): boolean {
    this.assertIndex(index);
    const wordIndex = index >>> 5;
    const mask = 1 << (index & 31);
    if ((this.bits[wordIndex]! & mask) !== 0) {
      return false;
    }

    this.bits[wordIndex] = this.bits[wordIndex]! | mask;
    this.indexes[this.length] = index;
    this.length += 1;
    return true;
  }

  public drain(visitor: (index: number) => void): void {
    const count = this.length;
    this.length = 0;
    for (let offset = 0; offset < count; offset += 1) {
      const index = this.indexes[offset]!;
      const wordIndex = index >>> 5;
      const mask = 1 << (index & 31);
      this.bits[wordIndex] = this.bits[wordIndex]! & ~mask;
      visitor(index);
    }
  }

  public clear(): void {
    this.bits.fill(0);
    this.length = 0;
  }

  private assertIndex(index: number): void {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.capacity) {
      throw new Error(
        `DenseIndexSet index ${index} is outside [0, ${Math.max(0, this.capacity - 1)}].`,
      );
    }
  }
}
