import { makeAutoObservable } from "mobx";
import {
  readRegionalMultiBaseExperimentalEnabled,
} from "@/shared/storage/regional-simulation-settings";

/**
 * 区域多基地仿真的 App 层 UI 状态。
 * 实验性总开关由设置对话框控制器写入；基地面板开关只在 stop 状态可写。
 */
class RegionalSimulationUiState {
  /** “允许多个基地同时运行”实验性设置；持久化到本地设置。 */
  public experimentalEnabled = readRegionalMultiBaseExperimentalEnabled();
  // AI-REMOVED 2026-08-19:
  // Reason: “同时运行所有基地”不能在 App UI state 与 SimulationState 中保存两份可变状态。
  // Trigger: 用户要求 SimulationMode 在未启动仿真时也可观察，并成为唯一事实来源。
  // Evidence: 原字段需要由 BasePanel 手工同步，设置关闭、编辑态和 Action 拒绝切换时均可能漂移。
  // Replacement: workspace.simulation.state.simulationMode。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // /** “同时运行所有基地”基地面板开关，默认关闭，应用重载即复位。 */
  // public allBasesEnabled = false;
  /** 当前区域其他基地数量。 */
  public siblingBaseCount = 0;

  public constructor() {
    makeAutoObservable(this);
  }

  public reset(): void {
    this.experimentalEnabled = false;
    // AI-REMOVED 2026-08-19:
    // Reason: App UI state 不再持有多基地模式，reset 只复位其拥有的 UI 字段。
    // Trigger: SimulationMode 单一事实源改造。
    // Evidence: 模式复位由 SimulationAction.setRegionalMultiBaseEnabled(false) 负责。
    // Replacement: SimulationStateReadWrite.simulationMode。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // this.allBasesEnabled = false;
    this.siblingBaseCount = 0;
  }
}

export const regionalSimulationUiState = new RegionalSimulationUiState();
