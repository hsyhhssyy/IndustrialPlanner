import type { AudioContract } from "@/domain/audio";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { DeviceAudioController } from "./device-audio-controller";

class AudioHost implements AudioContract {
  private readonly controller: DeviceAudioController;
  private destroyed = false;
  public readonly actions: AudioContract["actions"];

  public constructor(private readonly workspace: WorkspaceContract, readEnabled: () => boolean) {
    this.controller = new DeviceAudioController(workspace, readEnabled);
    this.actions = {
      unlock: () => { if (!this.destroyed) this.controller.unlock(); },
      playDeviceInspector: (entityId) => {
        if (!this.destroyed) this.controller.playDeviceInspector(entityId);
      },
    };
    this.controller.mount();
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    try {
      this.controller.dispose();
    } finally {
      if (this.workspace.audio === this) this.workspace.audio = null;
    }
  }
}

/** 组合根在 Editor / Simulation 就绪后装配；每个工作台只能拥有一个活动主机。 */
export function createAudioHost(
  workspace: WorkspaceContract,
  options: { readEnabled: () => boolean },
): AudioContract {
  if (workspace.audio) throw new Error("Audio is already initialized for this workspace");
  const host = new AudioHost(workspace, options.readEnabled);
  workspace.audio = host;
  return host;
}
