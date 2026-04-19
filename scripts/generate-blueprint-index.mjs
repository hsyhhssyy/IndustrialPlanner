import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const blueprintsDir = path.join(projectRoot, 'public', 'blueprints')
const indexPath = path.join(blueprintsDir, 'index.json')
const generatedDir = path.join(projectRoot, 'src', 'generated')
const blueprintIndexAssetPath = path.join(generatedDir, 'publicBlueprintIndex.ts')

const INDEX_SCHEMA_VERSION = 1
const USER_BLUEPRINT_ID_PATTERN = /^BluePrint-HSY-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/
const SYSTEM_BLUEPRINT_ID_PATTERN = /^PublicBluePrint-HSY-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const HASHED_INDEX_FILE_PATTERN = /^index\.[0-9a-f]{8}\.json$/

function normalizeBlueprintPayload(raw) {
  if (!raw || typeof raw !== 'object') return null
  const candidate = raw.blueprint && typeof raw.blueprint === 'object' ? raw.blueprint : raw
  if (!candidate || typeof candidate !== 'object') return null
  return candidate
}

function readIdAndVersions(payload) {
  const id = typeof payload.id === 'string' ? payload.id.trim() : ''
  const blueprintVersionValue = payload.blueprintVersion
  const blueprintVersion =
    typeof blueprintVersionValue === 'string' || typeof blueprintVersionValue === 'number'
      ? String(blueprintVersionValue).trim()
      : '1'
  return { id, blueprintVersion }
}

function normalizeToSystemBlueprintId(id) {
  if (SYSTEM_BLUEPRINT_ID_PATTERN.test(id)) return id
  const matchedUser = id.match(USER_BLUEPRINT_ID_PATTERN)
  if (!matchedUser) return null
  return `PublicBluePrint-HSY-${matchedUser[1]}`
}

async function ensureBlueprintDirectory() {
  await fs.mkdir(blueprintsDir, { recursive: true })
}

async function ensureGeneratedDirectory() {
  await fs.mkdir(generatedDir, { recursive: true })
}

async function writeBlueprintIndexAssetModule(fileName) {
  await ensureGeneratedDirectory()
  const source = [
    '// 由 scripts/generate-blueprint-index.mjs 自动生成，请勿手改。',
    `export const PUBLIC_BLUEPRINT_INDEX_PATH = ${JSON.stringify(`/blueprints/${fileName}`)}`,
    '',
  ].join('\n')
  await fs.writeFile(blueprintIndexAssetPath, source, 'utf8')
}

async function buildIndex() {
  await ensureBlueprintDirectory()

  const entries = await fs.readdir(blueprintsDir, { withFileTypes: true })
  const jsonFiles = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith('.json'))
    .filter((name) => name !== 'index.json')
    .filter((name) => !HASHED_INDEX_FILE_PATTERN.test(name))
    .sort((a, b) => a.localeCompare(b))

  const files = []
  const errors = []

  for (const fileName of jsonFiles) {
    const fullPath = path.join(blueprintsDir, fileName)
    const text = await fs.readFile(fullPath, 'utf8')
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      errors.push(`${fileName}: invalid JSON`)
      continue
    }

    const payload = normalizeBlueprintPayload(parsed)
    if (!payload) {
      errors.push(`${fileName}: invalid payload shape`)
      continue
    }

    const { id: rawId, blueprintVersion } = readIdAndVersions(payload)
    if (!rawId) {
      errors.push(`${fileName}: missing blueprint id`)
      continue
    }
    const id = normalizeToSystemBlueprintId(rawId)
    if (!id) {
      errors.push(
        `${fileName}: invalid blueprint id format, expected BluePrint-HSY-<uuid-v4-lowercase> or PublicBluePrint-HSY-<uuid-v4-lowercase>, received "${rawId}"`,
      )
      continue
    }
    if (!blueprintVersion) {
      errors.push(`${fileName}: missing blueprintVersion`)
      continue
    }

    const stat = await fs.stat(fullPath)
    files.push({
      id,
      blueprintVersion,
      name: fileName,
      path: `blueprints/${encodeURIComponent(fileName)}`,
      size: stat.size,
    })
  }

  if (errors.length > 0) {
    throw new Error(`Blueprint index generation failed:\n${errors.map((item) => `- ${item}`).join('\n')}`)
  }

  files.sort((a, b) => a.id.localeCompare(b.id))

  const indexPayload = {
    schemaVersion: INDEX_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    files,
  }
  const indexHash = crypto.createHash('sha1').update(JSON.stringify(indexPayload)).digest('hex').slice(0, 8)
  const hashedIndexName = `index.${indexHash}.json`
  const hashedIndexPath = path.join(blueprintsDir, hashedIndexName)
  const indexSource = `${JSON.stringify(indexPayload, null, 2)}\n`

  await fs.writeFile(indexPath, indexSource, 'utf8')
  await fs.writeFile(hashedIndexPath, indexSource, 'utf8')
  await writeBlueprintIndexAssetModule(hashedIndexName)

  const removedHashedIndexes = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!HASHED_INDEX_FILE_PATTERN.test(entry.name)) continue
    if (entry.name === hashedIndexName) continue
    await fs.rm(path.join(blueprintsDir, entry.name))
    removedHashedIndexes.push(entry.name)
  }

  console.log(`Generated blueprint index: public/blueprints/index.json (${files.length} entries)`)
  console.log(`Generated hashed blueprint index: public/blueprints/${hashedIndexName}`)
  console.log(`Generated blueprint index asset module: src/generated/publicBlueprintIndex.ts`)
  if (removedHashedIndexes.length > 0) {
    console.log(`Removed stale hashed blueprint indexes: ${removedHashedIndexes.join(', ')}`)
  }
}

buildIndex().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
