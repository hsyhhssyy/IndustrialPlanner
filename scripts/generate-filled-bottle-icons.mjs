import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const itemIconDir = path.join(projectRoot, 'public', 'itemicon')

const bottleItemIds = ['item_iron_bottle', 'item_glass_bottle', 'item_glass_enr_bottle', 'item_iron_enr_bottle']
const liquidItemIds = ['item_liquid_water', 'item_liquid_plant_grass_1', 'item_liquid_plant_grass_2', 'item_liquid_xiranite']

function outputIdFor(bottleId, liquidId) {
  const liquidSuffix = liquidId === 'item_liquid_water' ? 'water' : liquidId.replace(/^item_/, '')
  return `${bottleId}_filled_${liquidSuffix}`
}

async function composeIcon(bottleId, liquidId) {
  const bottlePath = path.join(itemIconDir, `${bottleId}.png`)
  const liquidPath = path.join(itemIconDir, `${liquidId}.png`)
  const outputId = outputIdFor(bottleId, liquidId)
  const outputPath = path.join(itemIconDir, `${outputId}.png`)

  const bottleMeta = await sharp(bottlePath).metadata()
  if (!bottleMeta.width || !bottleMeta.height) {
    throw new Error(`无法读取瓶子图标尺寸: ${bottlePath}`)
  }

  const overlayTargetWidth = Math.max(1, Math.round(bottleMeta.width * 0.5))
  const overlayTargetHeight = Math.max(1, Math.round(bottleMeta.height * 0.5))

  const overlayBuffer = await sharp(liquidPath)
    .resize(overlayTargetWidth, overlayTargetHeight, { fit: 'contain' })
    .png()
    .toBuffer()

  const overlayMeta = await sharp(overlayBuffer).metadata()
  if (!overlayMeta.width || !overlayMeta.height) {
    throw new Error(`无法读取液体叠加层尺寸: ${liquidPath}`)
  }

  const left = Math.round((bottleMeta.width - overlayMeta.width) / 2)
  const top = Math.round((bottleMeta.height - overlayMeta.height) / 2)

  await sharp(bottlePath)
    .composite([
      {
        input: overlayBuffer,
        left,
        top,
        blend: 'over',
      },
    ])
    .png()
    .toFile(outputPath)

  return outputPath
}

async function main() {
  const generated = []
  for (const bottleId of bottleItemIds) {
    for (const liquidId of liquidItemIds) {
      const outputPath = await composeIcon(bottleId, liquidId)
      generated.push(path.relative(projectRoot, outputPath))
    }
  }

  console.log(`已生成 ${generated.length} 个图标:`)
  for (const file of generated) {
    console.log(`- ${file}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
