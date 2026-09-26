export type DeviceAudioState = "build" | "remove" | "uiOpen" | "working" | "idle";

export interface DeviceAudioBinding {
  readonly clip: string;
  readonly eventId: number;
  readonly loop: boolean;
  readonly loopStart: number;
  readonly loopEnd: number;
  readonly duration: number;
}

export interface DeviceAudioManifest {
  readonly schemaVersion: 1;
  readonly sourceVersion: string;
  readonly clips: Readonly<Record<string, { readonly path: string; readonly bytes: number }>>;
  readonly definitions: Readonly<Record<string, Partial<Record<DeviceAudioState, DeviceAudioBinding>>>>;
}

/** 网络清单是运行时边界：失败整包拒绝，不猜测素材路径或状态。 */
export function parseDeviceAudioManifest(value: unknown): DeviceAudioManifest {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.sourceVersion !== "string"
    || !isRecord(value.clips) || !isRecord(value.definitions)) throw new Error("Invalid audio manifest");
  for (const [hash, clip] of Object.entries(value.clips)) {
    if (!/^[a-f0-9]{64}$/.test(hash) || !isRecord(clip)
      || clip.path !== `device-audio/${hash}.mp3`
      || typeof clip.bytes !== "number" || !Number.isSafeInteger(clip.bytes) || clip.bytes <= 0) {
      throw new Error("Invalid audio clip");
    }
  }
  for (const states of Object.values(value.definitions)) {
    if (!isRecord(states)) throw new Error("Invalid audio definition");
    for (const [state, binding] of Object.entries(states)) {
      if (!["build", "remove", "uiOpen", "working", "idle"].includes(state)
        || !isRecord(binding) || typeof binding.clip !== "string" || !value.clips[binding.clip]
        || typeof binding.eventId !== "number" || !Number.isSafeInteger(binding.eventId)
        || typeof binding.loop !== "boolean" || typeof binding.duration !== "number"
        || !Number.isFinite(binding.duration) || binding.duration <= 0
        || typeof binding.loopStart !== "number" || typeof binding.loopEnd !== "number"
        || !(binding.loopStart >= 0 && binding.loopEnd > binding.loopStart && binding.loopEnd <= binding.duration)) {
        throw new Error("Invalid audio state binding");
      }
    }
  }
  return value as unknown as DeviceAudioManifest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
