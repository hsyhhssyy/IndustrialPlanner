export interface PeriodicRangeConversionSource {
  readonly rangeIds: readonly string[];
  readonly side: 0 | 1;
  readonly program: PeriodicRangeConversionProgram;
}

export interface PeriodicRangeConversionProgram {
  readonly id: string;
  readonly periodSeconds: number;
  /** 依次对应单侧 0、单侧 1、双侧配对。 */
  readonly effects: readonly [
    PeriodicRangeConversionEffect,
    PeriodicRangeConversionEffect,
    PeriodicRangeConversionEffect,
  ];
}

export interface PeriodicRangeConversionEffect {
  readonly probabilityByLayer: readonly number[];
  readonly outputItemByInputId: Readonly<Record<string, string>>;
}
