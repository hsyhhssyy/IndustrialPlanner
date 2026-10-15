const URL_SCHEME_PATTERN = /^[a-z][a-z\d+\-.]*:/i;
const MISSING_ENTITY_ICON_ASSET_PATH = "textures/missing-sprite-texture.webp";
let iconAssetPaths: ReadonlySet<string> | undefined;

/** Vite仅展开文件名；缺图统一使用现有占位符，保留Registry中的真实图标ID。 */
function resolveIconAssetPath(path: string): string {
  const normalizedPath = path.replace(/^\/+/, "");
  if (!normalizedPath.startsWith("device-icons/") && !normalizedPath.startsWith("item-icons/")) return path;
  iconAssetPaths ??= new Set(Object.keys(import.meta.glob("/public/{device-icons,item-icons}/**/*"))
    .map(file => file.slice("/public/".length)));
  return iconAssetPaths.has(normalizedPath) ? normalizedPath : MISSING_ENTITY_ICON_ASSET_PATH;
}

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

export function createAbsolutePublicAssetUrl(path: string): string {
  return new URL(createPublicAssetUrl(path), document.baseURI).href;
}

export function createDeviceIconAssetUrl(iconId: string): string {
  return createPublicAssetUrl(resolveIconAssetPath(`device-icons/${iconId}.webp`));
}

export function createEntityIconAssetUrl(iconPath: string | undefined): string {
  return createPublicAssetUrl(resolveIconAssetPath(iconPath ?? MISSING_ENTITY_ICON_ASSET_PATH));
}

export function createItemIconAssetUrl(iconId: string): string {
  return createPublicAssetUrl(resolveIconAssetPath(`item-icons/${iconId}.webp`));
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
