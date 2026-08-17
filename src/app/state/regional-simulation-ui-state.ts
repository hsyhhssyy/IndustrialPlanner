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
  /** “同时运行所有基地”基地面板开关，默认关闭，应用重载即复位。 */
  public allBasesEnabled = false;
  /** 当前区域其他基地数量。 */
  public siblingBaseCount = 0;

  public constructor() {
    makeAutoObservable(this);
  }

  public reset(): void {
    this.experimentalEnabled = false;
    this.allBasesEnabled = false;
    this.siblingBaseCount = 0;
  }
}

export const regionalSimulationUiState = new RegionalSimulationUiState();
