/**
 * 物流删除图标生成脚本
 * 将 ant-design:stop-outlined（禁止符号）与 forward-filled / backward-filled（方向箭头）拼合，
 * 生成 remove-forward.svg 和 remove-backward.svg，放置于 public/svg/icons/ 目录。
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');

/** 加载 iconify json 图标数据 */
function loadIcons() {
  const iconsPath = join(REPO_ROOT, 'node_modules', '@iconify-json', 'ant-design', 'icons.json');
  const raw = readFileSync(iconsPath, 'utf-8');
  return JSON.parse(raw);
}

/** 根据图标名获取 body（SVG path 字符串） */
function getIconBody(icons, name) {
  const icon = icons.icons[name];
  if (!icon) throw new Error(`图标 ${name} 不存在`);
  return typeof icon === 'string' ? icon : icon.body;
}

/**
 * 将多个 path body 组装为完整 SVG 字符串
 * @param {string[]} bodies - 图标 body 字符串数组
 * @param {string} color - 填充色（默认 currentColor）
 */
function composeSvg(bodies, color = 'currentColor') {
  const paths = bodies.map((b) => b.replace(/fill="[^"]*"/g, `fill="${color}"`));
  return [
    // 跳过 XML 声明，直接开 SVG 标签
    '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 1024 1024">',
    ...paths,
    '</svg>',
  ].join('\n');
}

/** 生成单个图标文件 */
function generateIcon(icons, { name, parts }) {
  const bodies = parts.map((iconName) => getIconBody(icons, iconName));
  const svg = composeSvg(bodies);

  const outDir = join(REPO_ROOT, 'public', 'svg', 'icons');
  mkdirSync(outDir, { recursive: true });

  const outPath = join(outDir, `${name}.svg`);
  writeFileSync(outPath, svg + '\n', 'utf-8');
  console.log(`✓ 已生成: ${outPath}`);
}

function main() {
  console.log('加载 ant-design 图标集...');
  const icons = loadIcons();

  console.log('生成 remove-forward.svg (stop-outlined + forward-filled)...');
  generateIcon(icons, {
    name: 'remove-forward',
    parts: ['stop-outlined', 'forward-filled'],
  });

  console.log('生成 remove-backward.svg (stop-outlined + backward-filled)...');
  generateIcon(icons, {
    name: 'remove-backward',
    parts: ['stop-outlined', 'backward-filled'],
  });

  console.log('完成！');
}

main();
