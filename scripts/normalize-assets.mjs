import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import sharp from 'sharp'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const publicDir = path.join(projectRoot, 'public')
const generatedDir = path.join(projectRoot, 'src', 'generated')
const assetVersionFilePath = path.join(generatedDir, 'assetVersion.ts')
const originalDir = path.join(publicDir, 'original')
const atlasDir = path.join(publicDir, 'atlases')

const ACTIVE_ITEM_DIR = path.join(publicDir, 'itemicon')
const ACTIVE_DEVICE_DIR = path.join(publicDir, 'device-icons')
const ACTIVE_SPRITE_DIR = path.join(publicDir, 'sprites')
const ORIGINAL_ITEM_DIR = path.join(originalDir, 'itemicon')
const ORIGINAL_DEVICE_DIR = path.join(originalDir, 'device-icons')
const ORIGINAL_SPRITE_DIR = path.join(originalDir, 'sprites')

const SUPPORTED_INPUT_EXTENSIONS = new Set(['.png', '.svg', '.webp', '.jpg', '.jpeg'])
const ARCHIVE_EXTENSIONS = new Set(['.png', '.svg', '.jpg', '.jpeg'])
const ITEM_ICON_SIZE = 40
const DEVICE_ICON_SIZE = 30

async function pathExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function ensureDirectory(dirPath) {
  await fs.mkdir(dirPath, { recursive: true })
}

async function safeRename(sourcePath, targetPath) {
  try {
    await fs.rename(sourcePath, targetPath)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EXDEV') {
      await fs.copyFile(sourcePath, targetPath)
      await fs.rm(sourcePath)
      return
    }
    throw error
  }
}

async function listSourceFiles(dirPath) {
  if (!(await pathExists(dirPath))) return []
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((fileName) => SUPPORTED_INPUT_EXTENSIONS.has(path.extname(fileName).toLowerCase()))
    .sort((left, right) => left.localeCompare(right, 'en'))
}

async function archiveActiveSources(activeDir, archiveDir) {
  await ensureDirectory(activeDir)
  await ensureDirectory(archiveDir)
  const entries = await fs.readdir(activeDir, { withFileTypes: true })
  const moved = []

  for (const entry of entries) {
    if (!entry.isFile()) continue
    const ext = path.extname(entry.name).toLowerCase()
    if (!ARCHIVE_EXTENSIONS.has(ext)) continue

    const sourcePath = path.join(activeDir, entry.name)
    if (ext === '.svg') {
      const sourceContent = await fs.readFile(sourcePath, 'utf8').catch(() => '')
      if (sourceContent.includes('/atlases/')) {
        await fs.rm(sourcePath)
        continue
      }
    }
    const targetPath = path.join(archiveDir, entry.name)
    if (!(await pathExists(targetPath))) {
      await safeRename(sourcePath, targetPath)
      moved.push(entry.name)
    } else {
      await fs.rm(sourcePath)
    }
  }

  return moved
}

async function removeStaleGeneratedWebp(outputDir, expectedBaseNames) {
  if (!(await pathExists(outputDir))) return []
  const entries = await fs.readdir(outputDir, { withFileTypes: true })
  const removed = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (path.extname(entry.name).toLowerCase() !== '.webp') continue
    const baseName = path.basename(entry.name, '.webp')
    if (expectedBaseNames.has(baseName)) continue
    await fs.rm(path.join(outputDir, entry.name))
    removed.push(entry.name)
  }
  return removed
}

async function generateWebpIcons({ sourceDir, outputDir, outputSize }) {
  const sourceFiles = await listSourceFiles(sourceDir)
  await ensureDirectory(outputDir)
  const expectedBaseNames = new Set(sourceFiles.map((fileName) => path.basename(fileName, path.extname(fileName))))
  const removed = await removeStaleGeneratedWebp(outputDir, expectedBaseNames)
  const written = []

  for (const fileName of sourceFiles) {
    const sourcePath = path.join(sourceDir, fileName)
    const baseName = path.basename(fileName, path.extname(fileName))
    const outputPath = path.join(outputDir, `${baseName}.webp`)
    await sharp(sourcePath)
      .resize(outputSize, outputSize, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        kernel: sharp.kernel.lanczos3,
      })
      .webp({ quality: 90, alphaQuality: 100, effort: 6 })
      .toFile(outputPath)
    written.push(path.basename(outputPath))
  }

  return { written, removed, count: sourceFiles.length }
}

async function convertSprites({ sourceDir, outputDir }) {
  const sourceFiles = await listSourceFiles(sourceDir)
  await ensureDirectory(outputDir)
  const expectedBaseNames = new Set(sourceFiles.map((fileName) => path.basename(fileName, path.extname(fileName))))
  const removed = await removeStaleGeneratedWebp(outputDir, expectedBaseNames)
  const written = []

  for (const fileName of sourceFiles) {
    const sourcePath = path.join(sourceDir, fileName)
    const baseName = path.basename(fileName, path.extname(fileName))
    const outputPath = path.join(outputDir, `${baseName}.webp`)
    await sharp(sourcePath)
      .webp({ quality: 92, alphaQuality: 100, effort: 6 })
      .toFile(outputPath)
    written.push(path.basename(outputPath))
  }

  return { written, removed, count: sourceFiles.length }
}

async function removeLegacyAtlases() {
  if (!(await pathExists(atlasDir))) return false
  await fs.rm(atlasDir, { recursive: true, force: true })
  return true
}

async function listWebpFiles(dirPath) {
  if (!(await pathExists(dirPath))) return []
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((fileName) => path.extname(fileName).toLowerCase() === '.webp')
    .sort((left, right) => left.localeCompare(right, 'en'))
}

async function computeAssetVersionToken() {
  const hasher = crypto.createHash('sha1')
  const directories = [ACTIVE_ITEM_DIR, ACTIVE_DEVICE_DIR, ACTIVE_SPRITE_DIR]

  for (const dirPath of directories) {
    const webpFiles = await listWebpFiles(dirPath)
    hasher.update(`${path.basename(dirPath)}:${webpFiles.length}\n`)

    for (const fileName of webpFiles) {
      const filePath = path.join(dirPath, fileName)
      const content = await fs.readFile(filePath)
      hasher.update(fileName)
      hasher.update(content)
    }
  }

  return hasher.digest('hex').slice(0, 12)
}

async function writeAssetVersionToken(versionToken) {
  await ensureDirectory(generatedDir)
  const source = [
    '// 由 scripts/normalize-assets.mjs 自动生成，请勿手改。',
    `export const ASSET_CACHE_VERSION = '${versionToken}'`,
    '',
  ].join('\n')
  await fs.writeFile(assetVersionFilePath, source, 'utf8')
}

async function main() {
  const archivedItems = await archiveActiveSources(ACTIVE_ITEM_DIR, ORIGINAL_ITEM_DIR)
  const archivedDevices = await archiveActiveSources(ACTIVE_DEVICE_DIR, ORIGINAL_DEVICE_DIR)
  const archivedSprites = await archiveActiveSources(ACTIVE_SPRITE_DIR, ORIGINAL_SPRITE_DIR)

  const itemResult = await generateWebpIcons({
    sourceDir: ORIGINAL_ITEM_DIR,
    outputDir: ACTIVE_ITEM_DIR,
    outputSize: ITEM_ICON_SIZE,
  })
  const deviceResult = await generateWebpIcons({
    sourceDir: ORIGINAL_DEVICE_DIR,
    outputDir: ACTIVE_DEVICE_DIR,
    outputSize: DEVICE_ICON_SIZE,
  })
  const spriteResult = await convertSprites({
    sourceDir: ORIGINAL_SPRITE_DIR,
    outputDir: ACTIVE_SPRITE_DIR,
  })
  const removedAtlases = await removeLegacyAtlases()
  const assetVersionToken = await computeAssetVersionToken()
  await writeAssetVersionToken(assetVersionToken)

  console.log('资源归一化完成。')
  console.log(`- 归档 item 图标: ${archivedItems.length}`)
  console.log(`- 归档 device 图标: ${archivedDevices.length}`)
  console.log(`- 归档 sprite 源图: ${archivedSprites.length}`)
  console.log(`- item webp: ${itemResult.count} 项 -> public/itemicon`)
  console.log(`- device webp: ${deviceResult.count} 项 -> public/device-icons`)
  console.log(`- sprite webp: ${spriteResult.count} 项 -> public/sprites`)
  if (itemResult.removed.length > 0) console.log(`- 已删除 ${itemResult.removed.length} 个过期 item webp 输出`)
  if (deviceResult.removed.length > 0) console.log(`- 已删除 ${deviceResult.removed.length} 个过期 device webp 输出`)
  if (spriteResult.removed.length > 0) console.log(`- 已删除 ${spriteResult.removed.length} 个过期 sprite webp 输出`)
  if (removedAtlases) console.log('- 已清理旧 atlas 输出目录 public/atlases')
  console.log(`- 资源缓存版本: ${assetVersionToken}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
