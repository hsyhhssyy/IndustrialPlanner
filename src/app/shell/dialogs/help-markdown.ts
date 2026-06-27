import { marked, Renderer } from "marked";

export const FEATURE_GUIDE_INDEX_PATH = "/help/feature-guide/index.json";
export const CONFIG_GUIDE_INDEX_PATH = "/help/config-guide/index.json";

function createHelpRenderer(baseDir: string): Renderer {
  const renderer = new Renderer();
  renderer.image = function ({ href, title, text }: { href: string; title: string | null; text: string }) {
    const resolvedUrl = resolveHelpImageUrl(href, baseDir);
    const titleAttr = title !== null ? ` title="${escapeAttr(title)}"` : "";
    return `<img src="${escapeAttr(resolvedUrl)}" alt="${escapeAttr(text)}"${titleAttr} loading="lazy">`;
  };
  return renderer;
}

function resolveHelpImageUrl(url: string, baseDir: string): string {
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("/")) {
    return url;
  }
  if (url.startsWith("./")) {
    return `${baseDir}/${url.slice(2)}`;
  }
  return `${baseDir}/${url}`;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function stripLeadingMarkdownH1(markdown: string): string {
  return markdown
    .replace(/^\uFEFF/, "")
    .replace(/^\s*#(?!#)[^\r\n]*(?:\r?\n|$)/, "")
    .replace(/^\s*\r?\n/, "");
}

export function resolveHelpDocumentTitle(path: string, translate: (key: string) => string): string {
  const match = path.match(/^\/help\/(feature-guide|config-guide)\/(.+)\.md$/);
  if (!match) {
    const fileName = path.split("/").pop() ?? path;
    return fileName.replace(/\.md$/i, "");
  }
  const [, dir, name] = match;
  if (!name) return path;
  if (dir === "feature-guide") {
    const camel = name.replace(/-./g, (s) => s[1]!.toUpperCase());
    return translate(`toolboxDialog.tab.${camel}`);
  }

  return translate(`settingsField.${name}`);
}

export async function fetchHelpIndex(path: string): Promise<string[]> {
  const resp = await fetch(path);
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }

  return (await resp.json()) as string[];
}

export async function fetchHelpMarkdownHtml(path: string, options: {
  stripLeadingH1?: boolean;
} = {}): Promise<string> {
  const baseDir = path.substring(0, path.lastIndexOf("/"));
  const renderer = createHelpRenderer(baseDir);
  const resp = await fetch(path);
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
  const md = await resp.text();
  const parsed = await marked.parse(options.stripLeadingH1 ? stripLeadingMarkdownH1(md) : md, { renderer });

  return parsed as string;
}
