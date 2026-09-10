import {
  createSimulationStateReadWrite,
  type SimulationStateReadWrite,
  type RuntimeTickSnapshot,
} from "../contracts";

/** Legacy 的完整快照不参与公共状态，也不需要 MobX 深度观察。 */
export interface LegacyPresentationState {
  currentSnapshot: RuntimeTickSnapshot | null;
}

export interface LegacySimulationState {
  readonly state: SimulationStateReadWrite;
  readonly presentation: LegacyPresentationState;
}

export function createLegacySimulationState(): LegacySimulationState {
  return { state: createSimulationStateReadWrite(), presentation: { currentSnapshot: null } };
}

// AI-REMOVED 2026-09-09:
// Reason: 私有快照需与公共 State 在对象层面分开，不能仅依赖接口隐藏字段。
// Trigger: dense / legacy 公共状态边界重构。
// Evidence: Object.assign 会让 Host.internalState 仍暴露 legacy 完整快照。
// Replacement: LegacySimulationState.state 与 presentation 分别持有状态。
// Risk: Low
// Human Review: Required
// Original code:
// import { createSimulationStateReadWrite, type SimulationStateReadWrite, type RuntimeTickSnapshot } from "@/simulation/contracts";
//
// /** Legacy 的完整快照不参与公共状态，也不需要 MobX 深度观察。 */
// export interface LegacySimulationState extends SimulationStateReadWrite {
//   currentSnapshot: RuntimeTickSnapshot | null;
// }
//
// export function createLegacySimulationState(): LegacySimulationState {
//   return Object.assign(createSimulationStateReadWrite(), { currentSnapshot: null as RuntimeTickSnapshot | null });
// }
//
