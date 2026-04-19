import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)

const SOURCE_URL = 'https://end.wiki/zh-Hans/factory/recipes/'
const MACHINE_SECTION_MARKER = '<!-- Machine Recipes Section -->'
const MANUAL_SECTION_MARKER = '<!-- Manual Recipes Section -->'
const GROUP_OPEN_PATTERN = /<div class="recipe-browser-group"([^>]*)>/g
const HEADER_PATTERN = /<h3 class="recipe-browser-group-title"[^>]*>\s*(?:<a [^>]*>)?\s*([\s\S]*?)\s*(?:<\/a>)?\s*<\/h3>/
const GROUP_COUNT_PATTERN = /<span class="recipe-browser-group-count"[^>]*>\((\d+)\)<\/span>/
const BUILDING_LINK_PATTERN = /<a href="([^"]+)" class="group-(?:icon|title)-link"/
const TABLE_HEADER_PATTERN = /<thead[^>]*>[\s\S]*?<tr[^>]*>([\s\S]*?)<\/tr>[\s\S]*?<\/thead>/
const TH_PATTERN = /<th\b[^>]*>([\s\S]*?)<\/th>/g
const RECIPE_ROW_PATTERN = /<tr data-recipe-row\b([^>]*)>([\s\S]*?)<\/tr>/g
const TD_PATTERN = /<td\b[^>]*>([\s\S]*?)<\/td>/g
const RECIPE_TEXT_PATTERN = /data-recipe-text="([^"]*)"/
const ITEM_LINK_PATTERN = /<a class="mat-item has-hover" href="([^"]+)">([\s\S]*?)<\/a>/g
const IMAGE_ALT_PATTERN = /<img\b[^>]*alt="([^"]*)"/i
const VISIBLE_ITEM_TEXT_PATTERN = />\s*([^<]*?)\s*<span class="mat-hover-card"/s
const QUANTITY_PATTERN = /×\s*([0-9]+)/
const DURATION_PATTERN = /<span class="recipe-duration"[^>]*>([\s\S]*?)<\/span>/
const RARITY_PATTERN = /<span class="recipe-rarity"[^>]*>([\s\S]*?)<\/span>/
const UNLOCK_ITEM_PATTERN = /<span class="recipe-unlock-item"[^>]*>([\s\S]*?)<\/span>/g

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const outputDir = path.join(projectRoot, '.temp')
const outputJsonPath = path.join(outputDir, 'end-wiki-recipes-zh.json')
const outputMdPath = path.join(outputDir, 'end-wiki-recipes-zh.md')
const outputTsvPath = path.join(outputDir, 'end-wiki-recipes-zh.tsv')

function decodeHtmlEntities(text) {
  if (!text) return ''

  const namedEntities = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
    rsaquo: '›',
  }

  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const codePoint = Number.parseInt(entity.slice(2), 16)
      return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint)
    }
    if (entity.startsWith('#')) {
      const codePoint = Number.parseInt(entity.slice(1), 10)
      return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint)
    }
    return Object.hasOwn(namedEntities, entity) ? namedEntities[entity] : match
  })
}

function stripTags(html) {
  return html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')
}

function normalizeWhitespace(text) {
  return decodeHtmlEntities(text).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
}

function toAbsoluteUrl(href) {
  if (!href) return ''
  if (href.startsWith('http://') || href.startsWith('https://')) return href
  if (href.startsWith('/')) return `https://end.wiki${href}`
  return href
}

async function fetchHtml() {
  const { stdout } = await execFileAsync('curl', ['-L', '--silent', SOURCE_URL], {
    cwd: projectRoot,
    maxBuffer: 32 * 1024 * 1024,
  })
  if (!stdout || !stdout.includes('recipe-browser-group')) {
    throw new Error('Failed to fetch recipe page HTML or expected structure is missing.')
  }
  return stdout
}

function extractSectionHtml(html, startMarker, endMarker) {
  const startIndex = html.indexOf(startMarker)
  if (startIndex === -1) {
    throw new Error(`Missing section marker: ${startMarker}`)
  }

  const endIndex = endMarker ? html.indexOf(endMarker, startIndex + startMarker.length) : -1
  if (endMarker && endIndex === -1) {
    throw new Error(`Missing section marker: ${endMarker}`)
  }

  return html.slice(startIndex, endIndex === -1 ? undefined : endIndex)
}

function splitGroupBlocks(sectionHtml) {
  const matches = Array.from(sectionHtml.matchAll(GROUP_OPEN_PATTERN))
  return matches.map((match, index) => {
    const start = match.index
    const end = index + 1 < matches.length ? matches[index + 1].index : sectionHtml.length
    return sectionHtml.slice(start, end)
  })
}

function parseTableHeaders(groupHtml) {
  const headerMatch = groupHtml.match(TABLE_HEADER_PATTERN)
  if (!headerMatch) return []

  return Array.from(headerMatch[1].matchAll(TH_PATTERN))
    .map((match) => normalizeWhitespace(stripTags(match[1])))
    .filter(Boolean)
}

function parseRecipeItems(cellHtml) {
  const items = []
  for (const match of cellHtml.matchAll(ITEM_LINK_PATTERN)) {
    const href = toAbsoluteUrl(match[1])
    const body = match[2]
    const alt = normalizeWhitespace(body.match(IMAGE_ALT_PATTERN)?.[1] ?? '')
    const visibleText = normalizeWhitespace(body.match(VISIBLE_ITEM_TEXT_PATTERN)?.[1] ?? '')
    const quantity = Number.parseInt(visibleText.match(QUANTITY_PATTERN)?.[1] ?? '1', 10)
    const nameFromVisibleText = normalizeWhitespace(visibleText.replace(QUANTITY_PATTERN, ''))
    const name = alt || nameFromVisibleText
    if (!name) continue

    items.push({
      name,
      quantity: Number.isNaN(quantity) ? 1 : quantity,
      url: href,
    })
  }
  return items
}

function parseUnlockItems(cellHtml) {
  const unlocks = []
  for (const match of cellHtml.matchAll(UNLOCK_ITEM_PATTERN)) {
    const text = normalizeWhitespace(stripTags(match[1]))
    if (text) {
      unlocks.push(text)
    }
  }
  return unlocks
}

function parseRecipeRow(rowHtml, index) {
  const recipeText = normalizeWhitespace(decodeHtmlEntities(rowHtml.match(RECIPE_TEXT_PATTERN)?.[1] ?? ''))
  const cells = Array.from(rowHtml.matchAll(TD_PATTERN)).map((match) => match[1])

  const inputs = []
  const outputs = []
  let duration = ''
  let rarity = ''
  let unlocks = []

  for (const cellHtml of cells) {
    if (cellHtml.includes('class="recipe-items"')) {
      const items = parseRecipeItems(cellHtml)
      if (items.length === 0) continue
      if (inputs.length === 0) {
        inputs.push(...items)
      } else {
        outputs.push(...items)
      }
      continue
    }

    const durationMatch = cellHtml.match(DURATION_PATTERN)
    if (durationMatch) {
      duration = normalizeWhitespace(stripTags(durationMatch[1]))
      continue
    }

    const rarityMatch = cellHtml.match(RARITY_PATTERN)
    if (rarityMatch) {
      rarity = normalizeWhitespace(stripTags(rarityMatch[1]))
      continue
    }

    if (cellHtml.includes('class="recipe-unlock-cell"')) {
      unlocks = parseUnlockItems(cellHtml)
    }
  }

  return {
    index,
    recipeText,
    inputs,
    outputs,
    duration,
    rarity,
    unlocks,
  }
}

function parseGroup(sectionKey, groupHtml) {
  const openingTagMatch = groupHtml.match(/^<div class="recipe-browser-group"([^>]*)>/)
  const openingTag = openingTagMatch?.[1] ?? ''
  const groupId =
    openingTag.match(/data-machine-group="([^"]+)"/)?.[1]
    ?? openingTag.match(/data-manual-group="([^"]+)"/)?.[1]
    ?? ''
  const title = normalizeWhitespace(stripTags(groupHtml.match(HEADER_PATTERN)?.[1] ?? ''))
  const declaredCount = Number.parseInt(groupHtml.match(GROUP_COUNT_PATTERN)?.[1] ?? '0', 10)
  const buildingUrl = toAbsoluteUrl(groupHtml.match(BUILDING_LINK_PATTERN)?.[1] ?? '')
  const headers = parseTableHeaders(groupHtml)

  const recipes = Array.from(groupHtml.matchAll(RECIPE_ROW_PATTERN)).map((match, index) =>
    parseRecipeRow(match[0], index + 1),
  )

  if (!title) {
    throw new Error(`Missing group title for section ${sectionKey}, group ${groupId || '<unknown>'}`)
  }
  if (declaredCount !== recipes.length) {
    throw new Error(
      `Group count mismatch for ${title}: header says ${declaredCount}, parsed ${recipes.length}`,
    )
  }

  return {
    id: groupId,
    title,
    declaredCount,
    buildingUrl,
    headers,
    recipes,
  }
}

function parseSection(sectionKey, sectionHtml) {
  const groups = splitGroupBlocks(sectionHtml).map((groupHtml) => parseGroup(sectionKey, groupHtml))
  return {
    key: sectionKey,
    groupCount: groups.length,
    recipeCount: groups.reduce((sum, group) => sum + group.recipes.length, 0),
    groups,
  }
}

function formatItemsInline(items) {
  return items.map((item) => `${item.name} ×${item.quantity}`).join(' + ')
}

function formatItemUrls(items) {
  return items.map((item) => item.url).join(' | ')
}

function sanitizeTsvField(value) {
  return String(value ?? '').replace(/\t/g, ' ').replace(/\n/g, ' ').trim()
}

function buildMarkdown(payload) {
  const lines = [
    '# END Wiki 中文配方页导出',
    '',
    `来源: ${payload.sourceUrl}`,
    `生成时间: ${payload.generatedAt}`,
    `分区数: ${payload.sections.length}`,
    `分组数: ${payload.totalGroups}`,
    `配方行数: ${payload.totalRecipes}`,
    '',
    '## 分区摘要',
  ]

  for (const section of payload.sections) {
    lines.push(`- ${section.key}: ${section.groupCount} 组, ${section.recipeCount} 条配方`)
  }

  lines.push('', '## 分组摘要')
  for (const section of payload.sections) {
    lines.push(`### ${section.key}`)
    lines.push('')
    for (const group of section.groups) {
      const linkText = group.buildingUrl ? ` | ${group.buildingUrl}` : ''
      lines.push(`- ${group.title} (${group.declaredCount})${linkText}`)
    }
    lines.push('')
  }

  for (const section of payload.sections) {
    lines.push(`## ${section.key}`)
    lines.push('')
    for (const group of section.groups) {
      lines.push(`### ${group.title} (${group.declaredCount})`)
      lines.push('')
      if (group.buildingUrl) {
        lines.push(`设备页: ${group.buildingUrl}`)
        lines.push('')
      }
      for (const recipe of group.recipes) {
        const parts = [
          `[${recipe.index}] ${formatItemsInline(recipe.inputs)} -> ${formatItemsInline(recipe.outputs)}`,
        ]
        if (recipe.duration) parts.push(`耗时: ${recipe.duration}`)
        if (recipe.rarity) parts.push(`星级: ${recipe.rarity}`)
        if (recipe.unlocks.length > 0) parts.push(`解锁: ${recipe.unlocks.join(' + ')}`)
        lines.push(`- ${parts.join(' | ')}`)
      }
      lines.push('')
    }
  }

  return `${lines.join('\n')}\n`
}

function buildTsv(payload) {
  const lines = [
    [
      'section',
      'group_id',
      'group_title',
      'group_count',
      'row_index',
      'recipe_text',
      'inputs',
      'input_urls',
      'outputs',
      'output_urls',
      'duration',
      'rarity',
      'unlocks',
      'building_url',
    ].join('\t'),
  ]

  for (const section of payload.sections) {
    for (const group of section.groups) {
      for (const recipe of group.recipes) {
        lines.push(
          [
            section.key,
            group.id,
            group.title,
            group.declaredCount,
            recipe.index,
            recipe.recipeText,
            formatItemsInline(recipe.inputs),
            formatItemUrls(recipe.inputs),
            formatItemsInline(recipe.outputs),
            formatItemUrls(recipe.outputs),
            recipe.duration,
            recipe.rarity,
            recipe.unlocks.join(' | '),
            group.buildingUrl,
          ]
            .map(sanitizeTsvField)
            .join('\t'),
        )
      }
    }
  }

  return `${lines.join('\n')}\n`
}

async function writeOutputs(payload) {
  await fs.mkdir(outputDir, { recursive: true })
  await fs.writeFile(outputJsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  await fs.writeFile(outputMdPath, buildMarkdown(payload), 'utf8')
  await fs.writeFile(outputTsvPath, buildTsv(payload), 'utf8')
}

async function main() {
  const html = await fetchHtml()
  const machineSectionHtml = extractSectionHtml(html, MACHINE_SECTION_MARKER, MANUAL_SECTION_MARKER)
  const manualSectionHtml = extractSectionHtml(html, MANUAL_SECTION_MARKER)
  const sections = [
    parseSection('machine', machineSectionHtml),
    parseSection('manual', manualSectionHtml),
  ]

  const totalRecipes = sections.reduce((sum, section) => sum + section.recipeCount, 0)
  const totalGroups = sections.reduce((sum, section) => sum + section.groupCount, 0)
  const rawRecipeRowCount = html.match(/<tr data-recipe-row\b/g)?.length ?? 0

  if (totalRecipes !== rawRecipeRowCount) {
    throw new Error(`Total recipe row mismatch: parsed ${totalRecipes}, raw HTML contains ${rawRecipeRowCount}`)
  }

  const payload = {
    sourceUrl: SOURCE_URL,
    generatedAt: new Date().toISOString(),
    totalGroups,
    totalRecipes,
    sections,
  }

  await writeOutputs(payload)

  console.log(`Exported recipe list to ${path.relative(projectRoot, outputJsonPath)}`)
  console.log(`Exported recipe list to ${path.relative(projectRoot, outputMdPath)}`)
  console.log(`Exported recipe list to ${path.relative(projectRoot, outputTsvPath)}`)
  console.log(`Parsed ${totalGroups} groups and ${totalRecipes} recipe rows.`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})