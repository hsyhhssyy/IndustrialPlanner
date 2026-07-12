import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import opentype from 'opentype.js'
import sharp from 'sharp'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const UNIFONT_PATH = '/usr/share/fonts/opentype/unifont/unifont.otf'

const ICON_SIZE = 128
const GLYPH_TARGET_BOX_WIDTH = ICON_SIZE * 0.72
const GLYPH_TARGET_BOX_HEIGHT = ICON_SIZE * 0.72
const GLYPH_VERTICAL_OFFSET = ICON_SIZE * 0.02

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function loadFont() {
  const buf = fs.readFileSync(UNIFONT_PATH)
  const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  if (!font) throw new Error(`无法加载字体: ${UNIFONT_PATH}`)
  return font
}

function buildIconSvg(char, font) {
  const glyphPath = font.getPath(char, 0, 0, 1)
  const bbox = glyphPath.getBoundingBox()
  const glyphWidth = Math.max(bbox.x2 - bbox.x1, 1e-6)
  const glyphHeight = Math.max(bbox.y2 - bbox.y1, 1e-6)
  const glyphCenterX = (bbox.x1 + bbox.x2) / 2
  const glyphCenterY = (bbox.y1 + bbox.y2) / 2
  const scale = Math.min(
    GLYPH_TARGET_BOX_WIDTH / glyphWidth,
    GLYPH_TARGET_BOX_HEIGHT / glyphHeight,
  )
  const pathData = escapeXml(glyphPath.toPathData(3))

  return `
<svg width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="demo-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1e293b" />
      <stop offset="100%" stop-color="#0f172a" />
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${ICON_SIZE}" height="${ICON_SIZE}" rx="16" fill="url(#demo-bg)" />
  <rect x="4" y="4" width="${ICON_SIZE - 8}" height="${ICON_SIZE - 8}" rx="13" fill="none" stroke="#64748b" stroke-opacity="0.5" stroke-width="2" />
  <g transform="translate(${ICON_SIZE / 2} ${ICON_SIZE / 2 + GLYPH_VERTICAL_OFFSET}) scale(${scale}) translate(${-glyphCenterX} ${-glyphCenterY})">
    <path
      d="${pathData}"
      fill="#e2e8f0"
      stroke="#94a3b8"
      stroke-opacity="0.12"
      stroke-width="0.03"
      stroke-linejoin="round"
      paint-order="stroke fill"
    />
  </g>
</svg>`.trim()
}

function main() {
  const args = process.argv.slice(2)

  if (args.length < 2) {
    console.error('用法: node generate-demo-image-from-char.mjs <输出路径> <汉字>')
    console.error('示例: node generate-demo-image-from-char.mjs public/item-icons/item_ore.webp 矿')
    process.exitCode = 1
    return
  }

  const outputPath = path.resolve(args[0])
  const char = args[1]

  if (char.length !== 1) {
    console.error(`错误: 第二个参数必须是单个汉字，当前接收到 "${char}"`)
    process.exitCode = 1
    return
  }

  const outputDir = path.dirname(outputPath)

  fs.mkdirSync(outputDir, { recursive: true })

  const font = loadFont()
  const svg = buildIconSvg(char, font)

  sharp(Buffer.from(svg))
    .toFile(outputPath)
    .then(() => {
      console.log(`已生成: ${outputPath} (字: ${char})`)
    })
    .catch((error) => {
      console.error('生成失败:', error)
      process.exitCode = 1
    })
}

main()
