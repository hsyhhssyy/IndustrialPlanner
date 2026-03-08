import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const registryPath = path.join(projectRoot, 'src', 'domain', 'registry.ts')
const iconDir = path.join(projectRoot, 'public', 'itemicon')

const ICON_SIZE = 128
const FORCE_WRITE = process.argv.includes('--force')
const GLYPH_BY_ITEM_ID = {
  chrono_item_copper_ore: '铜',
  chrono_item_refined_copper: '精',
  chrono_item_wastewater: '污',
  chrono_item_copper_equip_script: '装',
  chrono_item_xiranite_waste_liquid: '废',
  chrono_item_inert_xiranite_waste_liquid: '惰',
  chrono_item_xiranite_waste_slag: '壤',
  chrono_item_medium_wuling_battery: '电',
}

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function parseChronoItemIds(registrySource) {
  const pattern = /id:\s*'((?:chrono_item)[a-zA-Z0-9_]*)'/g
  const ids = new Set()
  let match = pattern.exec(registrySource)
  while (match) {
    ids.add(match[1])
    match = pattern.exec(registrySource)
  }
  return [...ids].sort((left, right) => left.localeCompare(right))
}

function pickGlyphFromItemId(itemId) {
  const mappedGlyph = GLYPH_BY_ITEM_ID[itemId]
  if (mappedGlyph) return mappedGlyph

  const suffix = itemId.replace(/^chrono_item_?/, '')
  if (!suffix) return '时'

  const chineseMatch = suffix.match(/[\u4e00-\u9fff]/)
  if (chineseMatch) return chineseMatch[0]

  const alphaNumMatch = suffix.match(/[a-zA-Z0-9]/)
  if (!alphaNumMatch) return '时'
  return alphaNumMatch[0].toUpperCase()
}

function buildIconSvg(glyph) {
  const safeGlyph = escapeXml(glyph)
  return `
<svg width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="chrono-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#2b2f61" />
      <stop offset="100%" stop-color="#121631" />
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${ICON_SIZE}" height="${ICON_SIZE}" rx="18" fill="url(#chrono-bg)" />
  <rect x="6" y="6" width="${ICON_SIZE - 12}" height="${ICON_SIZE - 12}" rx="14" fill="none" stroke="#8ea2ff" stroke-opacity="0.65" stroke-width="2" />
  <text
    x="50%"
    y="50%"
    fill="#f7f9ff"
    font-size="72"
    font-family="'Noto Sans CJK SC','Microsoft YaHei','PingFang SC',Arial,sans-serif"
    font-weight="700"
    text-anchor="middle"
    dominant-baseline="central"
  >${safeGlyph}</text>
</svg>`.trim()
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function main() {
  const source = await fs.readFile(registryPath, 'utf8')
  const chronoItemIds = parseChronoItemIds(source)

  if (chronoItemIds.length === 0) {
    console.log('未检测到 chrono_item* 物品，无需生成图标。')
    return
  }

  await fs.mkdir(iconDir, { recursive: true })

  const generated = []
  const skipped = []
  for (const itemId of chronoItemIds) {
    const outputPath = path.join(iconDir, `${itemId}.png`)
    if (!FORCE_WRITE && (await fileExists(outputPath))) {
      skipped.push(itemId)
      continue
    }

    const glyph = pickGlyphFromItemId(itemId)
    const svg = buildIconSvg(glyph)
    await sharp(Buffer.from(svg)).png().toFile(outputPath)
    generated.push({ itemId, glyph })
  }

  console.log(`检测到 ${chronoItemIds.length} 个 chrono_item* 物品。`)
  if (generated.length > 0) {
    console.log(`已生成 ${generated.length} 个图标：`)
    for (const entry of generated) {
      console.log(`- ${entry.itemId}.png (字: ${entry.glyph})`)
    }
  }
  if (skipped.length > 0) {
    console.log(`跳过 ${skipped.length} 个已存在图标（可用 --force 覆盖）。`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
