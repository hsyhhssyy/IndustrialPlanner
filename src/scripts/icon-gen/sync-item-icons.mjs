import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { composeItemIcon, encodeItemIcon, readItemIconDefinitions, verifyItemIcon } from './item-icon-publisher.mjs'

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url))
const indexUrl = 'https://data.akedata.wiki/asset-sync-index.json'
const sourcePrefix = 'assets/beyond/dynamicassets/gameplay/ui/sprites/itemiconbig/'
const headers = { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.akedata.wiki/' }
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

export function buildItemIconPlan(items, index) {
  if (index.schemaVersion !== 2 || !index.revision || !index.datasets?.images?.files) {
    throw new Error('AKEData 资产索引格式不受支持')
  }
  const candidates = new Map()
  for (const [assetPath, record] of Object.entries(index.datasets.images.files)) {
    if (!assetPath.startsWith(sourcePrefix)) continue
    const key = assetPath.toLowerCase()
    const matches = candidates.get(key) ?? []
    matches.push([assetPath, record])
    candidates.set(key, matches)
  }
  const sources = []
  for (const item of items.filter(item => !item.containerId)) {
    if (sources.some(source => source.iconId === item.iconId)) continue
    const matches = candidates.get(`${sourcePrefix}${item.iconId}.png`.toLowerCase()) ?? []
    if (matches.length !== 1) throw new Error(`原图缺失或存在歧义：${item.iconId}（${matches.length} 个候选）`)
    const [assetPath, record] = matches[0]
    if (!Number.isSafeInteger(record.size) || record.size <= 0 || !/^[a-f\d]{32}$/.test(record.md5)
      || typeof record.version !== 'string' || !record.version) throw new Error(`原图索引记录无效：${assetPath}`)
    sources.push({ iconId: item.iconId, assetPath, size: record.size, md5: record.md5, version: record.version })
  }
  const sourceIds = new Set(sources.map(source => source.iconId))
  const composites = items.filter(item => item.containerId)
  if (composites.some(item => sourceIds.has(item.iconId))
    || new Set(composites.map(item => item.iconId)).size !== composites.length) {
    throw new Error('合成图标与原始图标的输出发生冲突')
  }
  return { sources, composites }
}

async function download(url) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}：${url}`)
  return Buffer.from(await response.arrayBuffer())
}

/** 完整生成、对账后才允许应用；每轮固定一份图片索引，不读取 TableCfg。 */
export async function syncItemIcons({ batchDirectory, indexFile, apply = false }) {
  const batch = path.resolve(batchDirectory)
  const temporaryRoot = path.resolve(projectRoot, '.temp/.trash')
  if (!batch.startsWith(`${temporaryRoot}${path.sep}`)) throw new Error('批次必须位于 .temp/.trash/ 下')
  await mkdir(path.join(batch, 'sources'), { recursive: true })
  const indexBytes = indexFile ? await readFile(indexFile) : await download(indexUrl)
  const index = JSON.parse(indexBytes.toString('utf8'))
  const items = await readItemIconDefinitions(path.join(projectRoot, 'src/registry/item-definition.ts'))
  const plan = buildItemIconPlan(items, index)
  await writeFile(path.join(batch, 'asset-sync-index.json'), indexBytes)
  const stage = path.join(batch, 'stage')
  await mkdir(stage, { recursive: true })
  const outputs = []
  const save = async (iconId, bytes, source) => {
    await verifyItemIcon(bytes)
    await writeFile(path.join(stage, `${iconId}.webp`), bytes)
    outputs.push({ iconId, ...source, bytes: bytes.length, sha256: sha256(bytes) })
  }
  for (const source of plan.sources) {
    const sourceUrl = `https://data.akedata.wiki/public/images/${source.assetPath}`
    const originalFile = path.join(batch, 'sources', `${source.iconId}.png`)
    let bytes
    try { bytes = await readFile(originalFile) } catch (error) {
      if (error.code !== 'ENOENT') throw error
      bytes = await download(sourceUrl)
    }
    if (bytes.length !== source.size || createHash('md5').update(bytes).digest('hex') !== source.md5) {
      throw new Error(`原件大小或 MD5 与固定索引不符：${source.assetPath}`)
    }
    await writeFile(originalFile, bytes)
    const encoded = await encodeItemIcon(bytes)
    const reference = await sharp(bytes).resize(256, 256).png().toBuffer()
    await verifyItemIcon(encoded, reference)
    const metadata = await sharp(bytes).metadata()
    await save(source.iconId, encoded, { kind: 'akedata', assetPath: source.assetPath, sourceUrl,
      version: source.version, sourceSize: source.size, sourceMd5: source.md5, sourceSha256: sha256(bytes),
      sourceWidth: metadata.width, sourceHeight: metadata.height })
  }
  const byId = new Map(items.map(item => [item.id, item]))
  for (const item of plan.composites) {
    const containerIconId = byId.get(item.containerId).iconId
    const contentIconId = byId.get(item.contentId).iconId
    const bytes = await composeItemIcon(await readFile(path.join(stage, `${containerIconId}.webp`)),
      await readFile(path.join(stage, `${contentIconId}.webp`)))
    await save(item.iconId, bytes, { kind: 'composite', containerIconId, contentIconId, overlayRatio: 0.5 })
  }
  const receipt = { schemaVersion: 1, source: 'akedata', indexUrl, revision: index.revision,
    indexSha256: sha256(indexBytes), width: 256, height: 256, encoding: 'webp-lossless',
    outputs: outputs.sort((a, b) => a.iconId.localeCompare(b.iconId)) }
  await writeFile(path.join(batch, 'item-icon-provenance.json'), `${JSON.stringify(receipt, null, 2)}\n`)
  if (apply) {
    const destination = path.join(projectRoot, 'public/item-icons')
    const filenames = new Set(outputs.map(output => `${output.iconId}.webp`))
    const extras = (await readdir(destination)).filter(filename => !filenames.has(filename))
    if (extras.length) throw new Error(`请先审阅并清理无引用图标：${extras.join(', ')}`)
    for (const output of outputs) {
      await copyFile(path.join(stage, `${output.iconId}.webp`), path.join(destination, `${output.iconId}.webp`))
    }
    await copyFile(path.join(batch, 'item-icon-provenance.json'), path.join(projectRoot, 'resources/item-icon-provenance.json'))
  }
  return { originalCount: plan.sources.length, compositeCount: plan.composites.length,
    totalBytes: outputs.reduce((sum, output) => sum + output.bytes, 0), revision: index.revision, applied: apply }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const value = flag => args[args.indexOf(flag) + 1]
  if (!args.includes('--batch') || !value('--batch') || args.some(arg => arg.startsWith('--')
    && !['--batch', '--index', '--apply'].includes(arg)) || (args.includes('--index') && !value('--index'))) {
    throw new Error('用法：node src/scripts/icon-gen/sync-item-icons.mjs --batch .temp/.trash/<批次> [--index <固定索引>] [--apply]')
  }
  syncItemIcons({ batchDirectory: value('--batch'), indexFile: args.includes('--index') ? value('--index') : undefined,
    apply: args.includes('--apply') }).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
