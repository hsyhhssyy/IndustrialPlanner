import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '../../..')
const itemIconDir = path.join(projectRoot, 'public', 'item-icons')

// ---------------------------------------------------------------------------
// 1. 解析 item-definition.ts，找出所有带 container / container-item tag 的物品
// ---------------------------------------------------------------------------
function parseBottledItems() {
  const itemDefPath = path.join(projectRoot, 'src', 'registry', 'item-definition.ts')
  const content = fs.readFileSync(itemDefPath, 'utf-8')

  // 用正则逐项匹配每个物品块
  const itemBlockPattern = /\{\s*\n\s*id:\s*"([^"]+)",\s*\n\s*nameKey:\s*"[^"]+",\s*\n\s*iconId:\s*"[^"]*",\s*\n\s*tags:\s*\[(.*?)\],/gs

  const bottledItems = []

  for (const match of content.matchAll(itemBlockPattern)) {
    const itemId = match[1]
    const tagsStr = match[2]

    // 提取 container:xxx 和 container-item:xxx
    const containerMatch = tagsStr.match(/"container:([^"]+)"/)
    const contentMatch = tagsStr.match(/"container-item:([^"]+)"/)

    if (containerMatch && contentMatch) {
      bottledItems.push({
        id: itemId,
        containerId: containerMatch[1],
        contentId: contentMatch[1],
      })
    }
  }

  return bottledItems
}

// ---------------------------------------------------------------------------
// 2. 图标合成
// ---------------------------------------------------------------------------
function findIconPath(itemId) {
  for (const ext of ['webp', 'png']) {
    const p = path.join(itemIconDir, `${itemId}.${ext}`)
    if (fs.existsSync(p)) return p
  }
  return null
}

async function composeIcon(bottledId, containerId, contentId) {
  const containerPath = findIconPath(containerId)
  const contentPath = findIconPath(contentId)
  const outputPath = path.join(itemIconDir, `${bottledId}.webp`)

  if (!containerPath) {
    console.warn(`  ⚠ 跳过 ${bottledId}: 容器图标不存在 (${containerId}.webp/png)`)
    return null
  }
  if (!contentPath) {
    console.warn(`  ⚠ 跳过 ${bottledId}: 内容物图标不存在 (${contentId}.webp/png)`)
    return null
  }

  const containerMeta = await sharp(containerPath).metadata()
  if (!containerMeta.width || !containerMeta.height) {
    throw new Error(`无法读取容器图标尺寸: ${containerPath}`)
  }

  // 内容物缩放到容器图标的 50%
  const overlayWidth = Math.max(1, Math.round(containerMeta.width * 0.5))
  const overlayHeight = Math.max(1, Math.round(containerMeta.height * 0.5))

  const overlayBuffer = await sharp(contentPath)
    .resize(overlayWidth, overlayHeight, { fit: 'contain' })
    .webp()
    .toBuffer()

  const overlayMeta = await sharp(overlayBuffer).metadata()

  const left = Math.round((containerMeta.width - (overlayMeta.width || overlayWidth)) / 2)
  const top = Math.round((containerMeta.height - (overlayMeta.height || overlayHeight)) / 2)

  await sharp(containerPath)
    .composite([
      {
        input: overlayBuffer,
        left,
        top,
        blend: 'over',
      },
    ])
    .webp({ lossless: true })
    .toFile(outputPath)

  return outputPath
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  console.log('📦 解析注册表中带 container / container-item tag 的物品...')
  const bottledItems = parseBottledItems()
  console.log(`   找到 ${bottledItems.length} 个瓶装物品\n`)

  let generated = 0
  let skipped = 0
  for (const item of bottledItems) {
    const result = await composeIcon(item.id, item.containerId, item.contentId)
    if (result) {
      console.log(`  ✅ ${path.relative(projectRoot, result)}`)
      generated++
    } else {
      skipped++
    }
  }

  console.log(`\n生成 ${generated} 个，跳过 ${skipped} 个`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
