import { marked, Renderer, type Token, type Tokens } from "marked";

export const FEATURE_GUIDE_INDEX_PATH = "/help/feature-guide/index.json";
export const CONFIG_GUIDE_INDEX_PATH = "/help/config-guide/index.json";
export const MISSING_HELP_TUTORIAL_IMAGE_PATH = "/help/__missing-tutorial-image__.png";

export interface HelpTutorialImage {
  alt: string;
  src: string;
  title: string | null;
}

export interface HelpTutorialPage {
  image: HelpTutorialImage | null;
  html: string;
}

function createHelpRenderer(baseDir: string): Renderer {
  const renderer = new Renderer();
  renderer.image = function ({ href, title, text }: { href: string; title: string | null; text: string }) {
    const resolvedUrl = resolveHelpImageUrl(href, baseDir);
    if (resolvedUrl === MISSING_HELP_TUTORIAL_IMAGE_PATH) {
      return "";
    }

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

function isImageOnlyParagraph(token: Token): token is Tokens.Paragraph {
  if (token.type !== "paragraph") {
    return false;
  }

  const paragraphToken = token as Tokens.Paragraph;

  return paragraphToken.tokens.length === 1
    && paragraphToken.tokens[0]?.type === "image";
}

function resolveTutorialImage(token: Tokens.Paragraph, baseDir: string): HelpTutorialImage {
  const imageToken = token.tokens[0] as Tokens.Image;

  return {
    alt: imageToken.text,
    src: resolveHelpImageUrl(imageToken.href, baseDir),
    title: imageToken.title,
  };
}

function parseTutorialPageHtml(tokens: Token[], renderer: Renderer): string {
  return marked.parser(tokens, { renderer }) as string;
}

function parseHelpTutorialPages(markdown: string, baseDir: string): HelpTutorialPage[] {
  const renderer = createHelpRenderer(baseDir);
  const tokens = marked.lexer(markdown);
  const pages: HelpTutorialPage[] = [];
  let currentPage: {
    image: HelpTutorialImage | null;
    tokens: Token[];
  } | null = null;

  for (const token of tokens) {
    if (token.type === "space") {
      continue;
    }

    if (isImageOnlyParagraph(token)) {
      if (currentPage !== null) {
        pages.push({
          image: currentPage.image,
          html: parseTutorialPageHtml(currentPage.tokens, renderer),
        });
      }

      currentPage = {
        image: resolveTutorialImage(token, baseDir),
        tokens: [],
      };
      continue;
    }

    if (currentPage === null) {
      currentPage = {
        image: null,
        tokens: [],
      };
    }

    currentPage.tokens.push(token);
  }

  if (currentPage !== null) {
    pages.push({
      image: currentPage.image,
      html: parseTutorialPageHtml(currentPage.tokens, renderer),
    });
  }

  return pages;
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

export async function fetchHelpTutorialPages(path: string, options: {
  stripLeadingH1?: boolean;
} = {}): Promise<HelpTutorialPage[]> {
  const baseDir = path.substring(0, path.lastIndexOf("/"));
  const resp = await fetch(path);
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
  const md = await resp.text();

  return parseHelpTutorialPages(options.stripLeadingH1 ? stripLeadingMarkdownH1(md) : md, baseDir);
}
