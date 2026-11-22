import { readFromLocalStorage } from "./browser-storage";

export const NETWORK_REGISTRY_SETTINGS_STORAGE_KEY = "v3-network-registry-settings";

export function readNetworkRegistrySettings(): { enabled: boolean; url: string } {
  const settings = readFromLocalStorage<Partial<{ enabled: boolean; url: string }>>(
    NETWORK_REGISTRY_SETTINGS_STORAGE_KEY,
  );
  return {
    enabled: settings?.enabled === true,
    url: typeof settings?.url === "string" ? settings.url : "",
  };
}
