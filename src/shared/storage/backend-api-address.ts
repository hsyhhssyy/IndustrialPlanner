import {
  readFromLocalStorage,
  saveToLocalStorage,
} from "./browser-storage";

export const BACKEND_API_ADDRESS_OVERRIDE_LOCAL_STORAGE_KEY = "v3-backend-api-address-override";
export const DEFAULT_BACKEND_API_HOST = "endfield-api.anonymous-test.top";
export const DEFAULT_BACKEND_API_BASE_URL = `https://${DEFAULT_BACKEND_API_HOST}`;
export const BUILD_BACKEND_API_BASE_URL =
  import.meta.env.VITE_BACKEND_API_BASE_URL?.trim() || DEFAULT_BACKEND_API_BASE_URL;

export function readBackendApiAddressOverride(): string {
  const value = readFromLocalStorage<string>(BACKEND_API_ADDRESS_OVERRIDE_LOCAL_STORAGE_KEY);

  return typeof value === "string" ? value : "";
}

export function writeBackendApiAddressOverride(value: string): string {
  return saveToLocalStorage(BACKEND_API_ADDRESS_OVERRIDE_LOCAL_STORAGE_KEY, value);
}

export function resolveBackendApiBaseUrl(): string {
  const override = readBackendApiAddressOverride().trim();
  return normalizeBackendApiBaseUrl(
    override === "" ? BUILD_BACKEND_API_BASE_URL : override,
  );
}

export function normalizeBackendApiBaseUrl(value: string): string {
  const trimmed = value.trim();

  if (trimmed === "") {
    return DEFAULT_BACKEND_API_BASE_URL;
  }

  return trimTrailingSlashes(hasHttpProtocol(trimmed)
    ? trimmed
    : `${resolveImplicitProtocol(trimmed)}://${trimmed}`);
}

function hasHttpProtocol(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function resolveImplicitProtocol(value: string): "http" | "https" {
  const lowerValue = value.toLowerCase();

  if (
    lowerValue.startsWith("localhost")
    || lowerValue.startsWith("127.")
    || lowerValue.startsWith("[::1]")
  ) {
    return "http";
  }

  return "https";
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}
