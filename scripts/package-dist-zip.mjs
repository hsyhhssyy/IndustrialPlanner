import fs from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import readline from 'node:readline/promises'
import { finished } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import yazl from 'yazl'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const distDir = path.join(projectRoot, 'dist')
const tempDir = path.join(projectRoot, '.temp')

function isValidVersion(version) {
  return /^[A-Za-z0-9._-]+$/.test(version)
}

async function collectFiles(dirPath, baseDir = dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath, baseDir)))
      continue
    }
    if (!entry.isFile()) continue
    files.push({
      fullPath,
      relativePath: path.relative(baseDir, fullPath).split(path.sep).join('/'),
    })
  }

  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function promptVersion() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  try {
    const answer = await rl.question('请输入版本号: ')
    return answer.trim()
  } finally {
    rl.close()
  }
}

async function runZip(outputPath) {
  const files = await collectFiles(distDir)
  if (files.length === 0) {
    throw new Error('dist 目录为空，请先执行 npm run build')
  }

  const zipFile = new yazl.ZipFile()
  const outputStream = createWriteStream(outputPath)
  const closePromise = finished(outputStream)

  zipFile.outputStream.pipe(outputStream)

  for (const file of files) {
    zipFile.addFile(file.fullPath, file.relativePath)
  }

  zipFile.end()
  await closePromise
}

async function main() {
  if (!(await pathExists(distDir))) {
    throw new Error('dist 目录不存在，请先执行 npm run build')
  }

  const version = await promptVersion()
  if (!version) {
    throw new Error('版本号不能为空')
  }
  if (!isValidVersion(version)) {
    throw new Error('版本号只能包含字母、数字、点、下划线和横线')
  }

  await fs.mkdir(tempDir, { recursive: true })
  const outputPath = path.join(tempDir, `IndustrialPlanner-${version}-dist.zip`)
  await fs.rm(outputPath, { force: true })

  console.log(`开始打包: ${outputPath}`)
  await runZip(outputPath)

  const stat = await fs.stat(outputPath)
  console.log(`打包完成: ${outputPath}`)
  console.log(`文件大小: ${(stat.size / 1024 / 1024).toFixed(2)} MB`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})