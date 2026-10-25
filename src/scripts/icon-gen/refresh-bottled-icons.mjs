// AI-REMOVED 2026-10-25:
// Reason: 正则只识别特定排版，合成过程有损编码且缺图时静默跳过。
// Trigger: 用户要求所有物品统一为 256×256 无损 WebP，并重新合成瓶装图标。
// Evidence: 原 overlayBuffer 使用默认 .webp()；原图目录含 40px 输入，旧脚本不校验固定尺寸。
// Replacement: 本文件 refreshBottledIcons 与 item-icon-publisher.mjs。
// Risk: 缺失、不足 256px 或无效的输入现在直接失败；不再生成部分成功的批次。
// Human Review: Required
//
// Original code:
// import fs from 'node:fs'
// import path from 'node:path'
// import process from 'node:process'
// import { fileURLToPath } from 'node:url'
// import sharp from 'sharp'
//
// const __filename = fileURLToPath(import.meta.url)
// const __dirname = path.dirname(__filename)
// const projectRoot = path.resolve(__dirname, '../../..')
// const itemIconDir = path.join(projectRoot, 'public', 'item-icons')
//
// // ---------------------------------------------------------------------------
// // 1. 解析 item-definition.ts，找出所有带 container / container-item tag 的物品
// // ---------------------------------------------------------------------------
// function parseBottledItems() {
//   const itemDefPath = path.join(projectRoot, 'src', 'registry', 'item-definition.ts')
//   const content = fs.readFileSync(itemDefPath, 'utf-8')
//
//   // 用正则逐项匹配每个物品块
//   const itemBlockPattern = /\{\s*\n\s*id:\s*"([^"]+)",\s*\n\s*nameKey:\s*"[^"]+",\s*\n\s*iconId:\s*"[^"]*",\s*\n\s*tags:\s*\[(.*?)\],/gs
//
//   const bottledItems = []
//
//   for (const match of content.matchAll(itemBlockPattern)) {
//     const itemId = match[1]
//     const tagsStr = match[2]
//
//     // 提取 container:xxx 和 container-item:xxx
//     const containerMatch = tagsStr.match(/"container:([^"]+)"/)
//     const contentMatch = tagsStr.match(/"container-item:([^"]+)"/)
//
//     if (containerMatch && contentMatch) {
//       bottledItems.push({
//         id: itemId,
//         containerId: containerMatch[1],
//         contentId: contentMatch[1],
//       })
//     }
//   }
//
//   return bottledItems
// }
//
// // ---------------------------------------------------------------------------
// // 2. 图标合成
// // ---------------------------------------------------------------------------
// function findIconPath(itemId) {
//   for (const ext of ['webp', 'png']) {
//     const p = path.join(itemIconDir, `${itemId}.${ext}`)
//     if (fs.existsSync(p)) return p
//   }
//   return null
// }
//
// async function composeIcon(bottledId, containerId, contentId) {
//   const containerPath = findIconPath(containerId)
//   const contentPath = findIconPath(contentId)
//   const outputPath = path.join(itemIconDir, `${bottledId}.webp`)
//
//   if (!containerPath) {
//     console.warn(`  ⚠ 跳过 ${bottledId}: 容器图标不存在 (${containerId}.webp/png)`)
//     return null
//   }
//   if (!contentPath) {
//     console.warn(`  ⚠ 跳过 ${bottledId}: 内容物图标不存在 (${contentId}.webp/png)`)
//     return null
//   }
//
//   const containerMeta = await sharp(containerPath).metadata()
//   if (!containerMeta.width || !containerMeta.height) {
//     throw new Error(`无法读取容器图标尺寸: ${containerPath}`)
//   }
//
//   // 内容物缩放到容器图标的 50%
//   const overlayWidth = Math.max(1, Math.round(containerMeta.width * 0.5))
//   const overlayHeight = Math.max(1, Math.round(containerMeta.height * 0.5))
//
//   const overlayBuffer = await sharp(contentPath)
//     .resize(overlayWidth, overlayHeight, { fit: 'contain' })
//     .webp()
//     .toBuffer()
//
//   const overlayMeta = await sharp(overlayBuffer).metadata()
//
//   const left = Math.round((containerMeta.width - (overlayMeta.width || overlayWidth)) / 2)
//   const top = Math.round((containerMeta.height - (overlayMeta.height || overlayHeight)) / 2)
//
//   await sharp(containerPath)
//     .composite([
//       {
//         input: overlayBuffer,
//         left,
//         top,
//         blend: 'over',
//       },
//     ])
//     .webp({ lossless: true })
//     .toFile(outputPath)
//
//   return outputPath
// }
//
// // ---------------------------------------------------------------------------
// // main
// // ---------------------------------------------------------------------------
// async function main() {
//   console.log('📦 解析注册表中带 container / container-item tag 的物品...')
//   const bottledItems = parseBottledItems()
//   console.log(`   找到 ${bottledItems.length} 个瓶装物品\n`)
//
//   let generated = 0
//   let skipped = 0
//   for (const item of bottledItems) {
//     const result = await composeIcon(item.id, item.containerId, item.contentId)
//     if (result) {
//       console.log(`  ✅ ${path.relative(projectRoot, result)}`)
//       generated++
//     } else {
//       skipped++
//     }
//   }
//
//   console.log(`\n生成 ${generated} 个，跳过 ${skipped} 个`)
// }
//
// main().catch((error) => {
//   console.error(error)
//   process.exitCode = 1
// })
//

import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { composeItemIcon, readItemIconDefinitions, verifyItemIcon } from './item-icon-publisher.mjs'

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url))

/** 先完成全部合成与校验，任何缺图或错误尺寸都在写入前失败。 */
export async function refreshBottledIcons({
  registryFile = path.join(projectRoot, 'src/registry/item-definition.ts'),
  iconDirectory = path.join(projectRoot, 'public/item-icons'),
  provenanceFile,
} = {}) {
  const items = await readItemIconDefinitions(registryFile)
  const byId = new Map(items.map(item => [item.id, item]))
  const outputs = []
  for (const item of items.filter(item => item.containerId)) {
    const containerIconId = byId.get(item.containerId).iconId
    const contentIconId = byId.get(item.contentId).iconId
    const container = await readFile(path.join(iconDirectory, containerIconId + '.webp'))
    const content = await readFile(path.join(iconDirectory, contentIconId + '.webp'))
    await verifyItemIcon(container)
    await verifyItemIcon(content)
    const bytes = await composeItemIcon(container, content)
    await verifyItemIcon(bytes)
    outputs.push({ iconId: item.iconId, bytes, containerIconId, contentIconId })
  }
  const receipt = provenanceFile ? JSON.parse(await readFile(provenanceFile, 'utf8')) : undefined
  for (const output of outputs) {
    if (receipt) {
      const record = receipt.outputs.find(record => record.iconId === output.iconId)
      if (!record || record.kind !== 'composite' || record.containerIconId !== output.containerIconId
        || record.contentIconId !== output.contentIconId) throw new Error('合成映射已变化，请使用 sync-item-icons.mjs 重新生成完整收据')
      record.bytes = output.bytes.length
      record.sha256 = createHash('sha256').update(output.bytes).digest('hex')
    }
  }
  for (const output of outputs) await writeFile(path.join(iconDirectory, output.iconId + '.webp'), output.bytes)
  if (receipt) await writeFile(provenanceFile, JSON.stringify(receipt, null, 2) + '\n')
  return { generated: outputs.length }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  refreshBottledIcons({ provenanceFile: path.join(projectRoot, 'resources/item-icon-provenance.json') })
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error); process.exitCode = 1 })
}
