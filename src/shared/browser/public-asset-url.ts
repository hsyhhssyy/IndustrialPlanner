const URL_SCHEME_PATTERN = /^[a-z][a-z\d+\-.]*:/i;
const MISSING_ENTITY_ICON_ASSET_PATH = "textures/missing-sprite-texture.png";

export function createPublicAssetUrl(path: string): string {
  if (URL_SCHEME_PATTERN.test(path) || path.startsWith("//")) {
    return path;
  }

  const normalizedPath = path.replace(/^\/+/, "");
  const baseUrl = import.meta.env.BASE_URL;
  const normalizedBaseUrl = baseUrl.length === 0 || baseUrl.endsWith("/")
    ? baseUrl
    : `${baseUrl}/`;

  if (normalizedBaseUrl.length > 0 && !normalizedBaseUrl.startsWith(".")) {
    return new URL(normalizedPath, `https://placeholder.local${normalizedBaseUrl}`).pathname;
  }

  return `${normalizedBaseUrl}${normalizedPath}`;
}

export function createDeviceIconAssetUrl(iconId: string): string {
  return createPublicAssetUrl(`device-icons/${iconId}.webp`);
}

export function createEntityIconAssetUrl(iconPath: string | undefined): string {
  return createPublicAssetUrl(iconPath ?? MISSING_ENTITY_ICON_ASSET_PATH);
}

export function createItemIconAssetUrl(iconId: string): string {
  return createPublicAssetUrl(`item-icons/${iconId}.webp`);
}

export function isRootPublicAssetBaseUrl(): boolean {
  const baseUrl = import.meta.env.BASE_URL;
  if (baseUrl === "/") {
    return true;
  }

  if (!baseUrl.startsWith(".")) {
    return false;
  }

  if (typeof window === "undefined") {
    return false;
  }

  return window.location.pathname === "/" || window.location.pathname === "/index.html";
}
