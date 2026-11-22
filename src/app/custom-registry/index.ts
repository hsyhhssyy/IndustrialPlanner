import { observable, runInAction } from "mobx";
import type { CustomRegistryContract } from "@/domain/registry/custom-registry-contract";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { trySaveToLocalStorage } from "@/shared/storage/browser-storage";
import {
  NETWORK_REGISTRY_SETTINGS_STORAGE_KEY,
  readNetworkRegistrySettings,
} from "@/shared/storage/network-registry-settings";
import { requestSyncProvider } from "@/shared/storage/sync-provider-activation";

interface NetworkRegistryStartupOptions {
  readonly builtinRegistry: RegistryContract;
  readonly compile: (input: unknown) => RegistryContract;
  readonly pageUrl: string;
}

interface CustomRegistrySessionOptions extends NetworkRegistryStartupOptions {
  readonly apply: (registry: RegistryContract) => Promise<void>;
}

async function fetchRegistryInput(url: string, pageUrl: string, signal: AbortSignal): Promise<unknown> {
  let target: URL;
  try {
    if (url === "") throw new TypeError();
    target = new URL(url, pageUrl);
    if (target.protocol !== "https:" && target.protocol !== "http:") throw new TypeError();
  } catch {
    throw new Error("settingsField.network-registry-invalid-url");
  }
  const timeout = AbortSignal.timeout(15_000);
  const requestSignal = AbortSignal.any([signal, timeout]);
  const throwIfAborted = () => {
    signal.throwIfAborted();
    if (timeout.aborted) throw new Error("settingsField.network-registry-timeout");
  };
  let response: Response;
  try {
    response = await fetch(target, { cache: "no-store", signal: requestSignal });
  } catch (error) {
    throwIfAborted();
    throw new Error("settingsField.network-registry-unreachable", { cause: error });
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  try {
    const input: unknown = await response.json();
    throwIfAborted();
    return input;
  } catch (error) {
    throwIfAborted();
    throw new Error("settingsField.network-registry-invalid-json", { cause: error });
  }
}

/** 嵌入页只有启动快照，没有可修改的工作台设置。 */
export async function loadReadonlyNetworkRegistry(
  options: NetworkRegistryStartupOptions,
  signal: AbortSignal,
): Promise<RegistryContract> {
  const { enabled, url } = readNetworkRegistrySettings();
  if (!enabled) return options.builtinRegistry;
  try {
    return options.compile(await fetchRegistryInput(url, options.pageUrl, signal));
  } catch {
    signal.throwIfAborted();
    return options.builtinRegistry;
  }
}

export function createCustomRegistrySession(options: CustomRegistrySessionOptions) {
  type State = ReturnType<CustomRegistryContract["getState"]>;
  const state = observable.box<State>({
    ...readNetworkRegistrySettings(),
    activeUrl: null,
    loading: false,
    applying: false,
    error: null,
  }, { deep: false });
  let pending: AbortController | null = null;
  let disposed = false;
  let registry = options.builtinRegistry;

  function update(patch: Partial<State>): void {
    runInAction(() => state.set({ ...state.get(), ...patch }));
  }

  function save(enabled: boolean, url: string): boolean {
    if (trySaveToLocalStorage(NETWORK_REGISTRY_SETTINGS_STORAGE_KEY, { enabled, url })) {
      update({ enabled, url });
      return true;
    }
    update({ error: { url, message: "settingsField.network-registry-save-failed" } });
    return false;
  }

  function fail(url: string, error: unknown): void {
    update({ error: {
      url,
      message: error instanceof Error ? error.message : String(error),
    } });
  }

  async function load(url: string, initial: boolean): Promise<void> {
    pending?.abort();
    const request = new AbortController();
    pending = request;
    update({ loading: true, error: null });
    try {
      const input = await fetchRegistryInput(url, options.pageUrl, request.signal);
      if (disposed || pending !== request) return;
      const next = options.compile(input);
      if (!initial) {
        update({ applying: true });
        await options.apply(next);
      }
      registry = next;
      update({ activeUrl: url });
    } catch (error) {
      if (!disposed && pending === request) fail(url, error);
    } finally {
      if (pending === request) {
        pending = null;
        update({ loading: false, applying: false });
      }
    }
  }

  const contract: CustomRegistryContract = {
    getState: () => state.get(),
    async setEnabled(enabled) {
      const current = state.get();
      if (disposed || current.applying || enabled === current.enabled) return;
      if (enabled && !requestSyncProvider("none")) {
        fail(current.url, new Error("settingsField.network-registry-save-failed"));
        return;
      }
      if (!save(enabled, current.url)) return;
      if (enabled) {
        if (current.url !== "") await load(current.url, false);
        return;
      }
      pending?.abort();
      pending = null;
      update({ loading: false, error: null });
      if (current.activeUrl === null) return;
      update({ applying: true });
      try {
        await options.apply(options.builtinRegistry);
        registry = options.builtinRegistry;
        update({ activeUrl: null });
      } catch (error) {
        save(true, current.url);
        fail(current.url, error);
      } finally {
        update({ applying: false });
      }
    },
    async submitUrl(value) {
      const current = state.get();
      if (disposed || current.applying || !current.enabled) return;
      const url = value.trim();
      if (url === current.url || !save(true, url)) return;
      await load(url, false);
    },
    async refresh() {
      const current = state.get();
      if (disposed || current.applying || !current.enabled) return;
      await load(current.url, false);
    },
  };
  return {
    ...contract,
    async initialize(): Promise<RegistryContract> {
      const current = state.get();
      if (current.enabled) {
        requestSyncProvider("none");
        await load(current.url, true);
      }
      return registry;
    },
    dispose(): void {
      disposed = true;
      pending?.abort();
      pending = null;
    },
  };
}
