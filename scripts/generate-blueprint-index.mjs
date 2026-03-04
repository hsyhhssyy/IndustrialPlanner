import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const blueprintsDir = path.join(projectRoot, 'public', 'blueprints')
const indexPath = path.join(blueprintsDir, 'index.json')

const INDEX_SCHEMA_VERSION = 1
const USER_BLUEPRINT_ID_PATTERN = /^BluePrint-HSY-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/
const SYSTEM_BLUEPRINT_ID_PATTERN = /^PublicBluePrint-HSY-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function normalizeBlueprintPayload(raw) {
  if (!raw || typeof raw !== 'object') return null
  const candidate = raw.blueprint && typeof raw.blueprint === 'object' ? raw.blueprint : raw
  if (!candidate || typeof candidate !== 'object') return null
  return candidate
}

function readIdAndVersion(payload) {
  const id = typeof payload.id === 'string' ? payload.id.trim() : ''
  const versionValue = payload.version
  const version = typeof versionValue === 'string' || typeof versionValue === 'number' ? String(versionValue).trim() : ''
  return { id, version }
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

async function buildIndex() {
  await ensureBlueprintDirectory()

  const entries = await fs.readdir(blueprintsDir, { withFileTypes: true })
  const jsonFiles = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith('.json'))
    .filter((name) => name !== 'index.json')
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

    const { id: rawId, version } = readIdAndVersion(payload)
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
    if (!version) {
      errors.push(`${fileName}: missing blueprint version`)
      continue
    }

    const stat = await fs.stat(fullPath)
    files.push({
      id,
      version,
      name: fileName,
      path: `/blueprints/${encodeURIComponent(fileName)}`,
      size: stat.size,
    })
  }

  if (errors.length > 0) {
    throw new Error(`Blueprint index generation failed:\n${errors.map((item) => `- ${item}`).join('\n')}`)
  }

  files.sort((a, b) => a.id.localeCompare(b.id))

  const indexPayload = {
    version: INDEX_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    files,
  }

  await fs.writeFile(indexPath, `${JSON.stringify(indexPayload, null, 2)}\n`, 'utf8')

  console.log(`Generated blueprint index: public/blueprints/index.json (${files.length} entries)`)
}

buildIndex().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
