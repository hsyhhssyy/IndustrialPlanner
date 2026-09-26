import { createPublicAssetUrl } from "@/shared/browser/public-asset-url";
import type { DeviceAudioBinding, DeviceAudioManifest } from "./audio-manifest";

const MAX_VOICES = 24;
const MAX_WORK_VOICES = 20;
const MAX_DECODED_BYTES = 64 * 1024 * 1024;

interface Voice {
  readonly key: string;
  readonly entityId: string;
  readonly binding: DeviceAudioBinding;
  readonly work: boolean;
  readonly requestedAt: number;
  readonly gain: number;
  readonly isCurrent: () => boolean;
  source: AudioBufferSourceNode | null;
  node: GainNode | null;
  buffer: AudioBuffer | null;
  offset: number;
  startedAt: number;
}

/** 一个工作台一个混音器；网络/解码失败只影响声音，不影响编辑提交。 */
export class DeviceAudioPlayer {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly voices = new Map<string, Voice>();
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly failed = new Map<string, number>();
  private readonly loads = new Map<string, Promise<AudioBuffer | null>>();
  private readonly activeLoads = new Set<Promise<AudioBuffer | null>>();
  private readonly requests = new Set<AbortController>();
  private decodedBytes = 0;
  private reservedBytes = 0;
  private generation = 0;
  private enabled = false;
  private workPaused = false;
  private deviceGains: ReadonlyMap<string, number> = new Map();

  public get ready(): boolean { return this.enabled && this.context?.state === "running"; }
  public get activeDeviceIds(): ReadonlySet<string> { return new Set([...this.voices.values()].map((voice) => voice.entityId)); }

  public setDeviceGains(gains: ReadonlyMap<string, number>): void {
    this.deviceGains = gains;
    for (const voice of this.voices.values()) {
      const gain = gains.get(voice.entityId);
      if (gain === undefined) this.stop(voice.key);
      else if (voice.node) voice.node.gain.value = voice.gain * gain;
    }
  }

  public setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) this.dispose();
  }

  /** 仅从真实 pointer/keyboard/click 事件调用，不能在异步加载完成后自动解锁。 */
  public unlock(): void {
    if (!this.enabled || typeof AudioContext === "undefined") return;
    try {
      if (this.context === null) {
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.gain.value = 0.22;
        const compressor = this.context.createDynamicsCompressor();
        this.master.connect(compressor);
        compressor.connect(this.context.destination);
      }
      if (this.context.state !== "running") void this.context.resume().catch(() => undefined);
    } catch (error) {
      console.warn("Device audio is unavailable", error);
    }
  }

  public play(key: string, entityId: string, binding: DeviceAudioBinding, manifest: DeviceAudioManifest, work: boolean, gain = 1, isCurrent = () => true): void {
    if (!this.ready || !this.deviceGains.has(entityId) || this.voices.has(key) || (work && this.workPaused)) return;
    const workCount = [...this.voices.values()].filter((voice) => voice.work).length;
    if (work && workCount >= MAX_WORK_VOICES) return;
    if (this.voices.size >= MAX_VOICES) {
      const oldest = [...this.voices.values()].find((voice) => !voice.work);
      if (work || !oldest) return;
      this.stop(oldest.key);
    }
    const voice: Voice = { key, entityId, binding, work, gain, isCurrent, requestedAt: performance.now(),
      source: null, node: null, buffer: null, offset: 0, startedAt: 0 };
    this.voices.set(key, voice);
    void this.load(binding.clip, manifest).then((buffer) => {
      if (this.voices.get(key) !== voice) return;
      if (!buffer || !voice.isCurrent() || (!binding.loop && performance.now() - voice.requestedAt > 1500)) {
        this.stop(key);
        return;
      }
      voice.buffer = buffer;
      if (!work || !this.workPaused) this.startVoice(voice);
    });
  }

  public retainWork(keys: ReadonlySet<string>): void {
    for (const voice of this.voices.values()) {
      if (voice.work && !keys.has(voice.key)) this.stop(voice.key);
    }
  }

  public pauseWork(paused: boolean): void {
    if (this.workPaused === paused) return;
    this.workPaused = paused;
    for (const voice of this.voices.values()) {
      if (!voice.work) continue;
      if (paused && voice.source && this.context) {
        voice.offset += this.context.currentTime - voice.startedAt;
        this.detach(voice);
      } else if (!paused && voice.buffer && !voice.source) this.startVoice(voice);
    }
  }

  public stopAll(): void {
    for (const key of this.voices.keys()) this.stop(key);
    for (const request of this.requests) request.abort();
  }

  public discardInvalidVoices(): void {
    for (const voice of this.voices.values()) if (!voice.isCurrent()) this.stop(voice.key);
  }

  public dispose(): void {
    this.generation++;
    this.stopAll();
    for (const request of this.requests) request.abort();
    this.requests.clear();
    this.loads.clear();
    this.activeLoads.clear();
    this.buffers.clear();
    this.failed.clear();
    this.decodedBytes = 0;
    this.reservedBytes = 0;
    if (this.context) void this.context.close().catch(() => undefined);
    this.context = null;
    this.master = null;
    this.workPaused = false;
    this.deviceGains = new Map();
  }

  private stop(key: string): void {
    const voice = this.voices.get(key);
    if (!voice) return;
    this.detach(voice);
    this.voices.delete(key);
  }

  private detach(voice: Voice): void {
    if (voice.source) {
      voice.source.onended = null;
      voice.source.stop();
      voice.source.disconnect();
    }
    voice.node?.disconnect();
    voice.source = null;
    voice.node = null;
  }

  private startVoice(voice: Voice): void {
    const context = this.context;
    if (!context || !this.master || !voice.buffer) return;
    const { binding, buffer } = voice;
    let offset = voice.offset;
    if (binding.loop) {
      const end = Math.min(binding.loopEnd, buffer.duration);
      const span = end - binding.loopStart;
      if (span <= 0) { this.stop(voice.key); return; }
      if (offset >= end) offset = binding.loopStart + (offset - binding.loopStart) % span;
    } else if (offset >= buffer.duration) { this.stop(voice.key); return; }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = binding.loop;
    source.loopStart = binding.loopStart;
    source.loopEnd = Math.min(binding.loopEnd, buffer.duration);
    const node = context.createGain();
    node.gain.value = voice.gain * (this.deviceGains.get(voice.entityId) ?? 0);
    source.connect(node);
    node.connect(this.master);
    voice.source = source;
    voice.node = node;
    voice.offset = offset;
    voice.startedAt = context.currentTime;
    source.onended = () => { if (voice.source === source) this.stop(voice.key); };
    source.start(0, offset);
  }

  private async load(hash: string, manifest: DeviceAudioManifest): Promise<AudioBuffer | null> {
    const cached = this.buffers.get(hash);
    if (cached) {
      this.buffers.delete(hash);
      this.buffers.set(hash, cached);
      return cached;
    }
    const pending = this.loads.get(hash);
    if (pending) return pending;
    if ((this.failed.get(hash) ?? 0) > performance.now() || !this.context || this.loads.size >= MAX_VOICES) return null;
    const clip = manifest.clips[hash];
    if (!clip) return null;
    const generation = this.generation;
    const context = this.context;
    const request = new AbortController();
    this.requests.add(request);
    const load: Promise<AudioBuffer | null> = Promise.resolve().then(async () => {
      let reserved = 0;
      try {
        // 最多两项下载/解码；其余已选声源排队，关闭或实体失效后不再启动网络请求。
        await Promise.resolve();
        while (this.activeLoads.size >= 2 && generation === this.generation) await Promise.race(this.activeLoads);
        if (generation !== this.generation || ![...this.voices.values()].some((voice) => voice.binding.clip === hash)) return null;
        this.activeLoads.add(load);
        const duration = Math.max(...Object.values(manifest.definitions).flatMap((states) =>
          Object.values(states).filter((binding) => binding.clip === hash).map((binding) => binding.duration)));
        reserved = Math.ceil((duration + 0.1) * context.sampleRate) * 2 * 4;
        if (!this.makeRoom(reserved)) { reserved = 0; return null; }
        this.reservedBytes += reserved;
        const response = await fetch(createPublicAssetUrl(clip.path), { signal: request.signal });
        if (!response.ok) throw new Error(`Audio HTTP ${response.status}`);
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength !== clip.bytes) throw new Error("Audio size mismatch");
        if (request.signal.aborted || ![...this.voices.values()].some((voice) => voice.binding.clip === hash)) return null;
        const buffer = await context.decodeAudioData(bytes);
        if (generation !== this.generation) return null;
        const size = buffer.length * buffer.numberOfChannels * 4;
        this.reservedBytes -= reserved;
        reserved = 0;
        // 正在播放或暂停的 buffer 也计入预算；不能通过 LRU 驱逐掩盖实际内存占用。
        for (const [key, candidate] of this.buffers) {
          if (this.decodedBytes + this.reservedBytes + size <= MAX_DECODED_BYTES) break;
          if ([...this.voices.values()].some((voice) => voice.binding.clip === key)) continue;
          this.buffers.delete(key);
          this.decodedBytes -= candidate.length * candidate.numberOfChannels * 4;
        }
        if (this.decodedBytes + this.reservedBytes + size > MAX_DECODED_BYTES) return null;
        this.buffers.set(hash, buffer);
        this.decodedBytes += size;
        return buffer;
      } catch (error) {
        if (!request.signal.aborted && generation === this.generation) {
          this.failed.set(hash, performance.now() + 30_000);
          console.warn("Device audio failed to load", clip.path, error);
        }
        return null;
      } finally {
        this.requests.delete(request);
        if (generation === this.generation) {
          this.loads.delete(hash);
          this.activeLoads.delete(load);
          this.reservedBytes -= reserved;
        }
      }
    });
    this.loads.set(hash, load);
    return load;
  }

  private makeRoom(bytes: number): boolean {
    for (const [hash, buffer] of this.buffers) {
      if (this.decodedBytes + this.reservedBytes + bytes <= MAX_DECODED_BYTES) break;
      if ([...this.voices.values()].some((voice) => voice.binding.clip === hash)) continue;
      this.buffers.delete(hash);
      this.decodedBytes -= buffer.length * buffer.numberOfChannels * 4;
    }
    return this.decodedBytes + this.reservedBytes + bytes <= MAX_DECODED_BYTES;
  }
}
