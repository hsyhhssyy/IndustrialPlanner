export type FormationEffect = "ming" | "hui" | "heng";

export interface FormationDefinition {
  readonly id: string;
  readonly periodSeconds: number;
  readonly effects: Readonly<Record<FormationEffect, FormationEffectDefinition>>;
}

export interface FormationEffectDefinition {
  readonly machineId: string;
  readonly selectionRatioByLayer: readonly number[];
}

export interface PeriodicRangeConversionSource {
  readonly rangeIds: readonly string[];
  readonly side: 0 | 1;
  readonly programId: string;
}

/** 网络格式 v1 的输入表示，在注册表编译时展开。 */
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

// AI-REMOVED 2026-11-26:
// Reason: ST3-RQ-002 物料关系、分层概率和投影范围分别由配方行为及本地口声明。
// Trigger: 阵列四层必成、双口独立和跨读者单一配方来源的已确认需求。
// Evidence: 此文件的原有声明或消费者引用已迁入下述实现，回归清单见 ST3-RQ-002 执行日志。
// Replacement: registry/recipe-definition.ts、registry/entity-definition.ts 与 shared/formation-recipes.ts
// Risk: 恢复历史逻辑会同时启用两条业务路径。
// Human Review: Required
//
// Original code:
//   readonly program: PeriodicRangeConversionProgram;
