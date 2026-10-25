import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import ts from 'typescript'

export const ITEM_ICON_SIZE = 256

/** 只读取活动数组的字面量；不执行 Registry，也不把审计注释视为物品。 */
export function parseItemIconDefinitions(sourceText) {
  const source = ts.createSourceFile('item-definition.ts', sourceText, ts.ScriptTarget.Latest, true)
  if (source.parseDiagnostics.length) throw new Error('物品定义无法解析')
  const declarations = source.statements.filter(ts.isVariableStatement)
    .flatMap(statement => [...statement.declarationList.declarations])
  const array = declarations.find(declaration => ts.isIdentifier(declaration.name)
    && declaration.name.text === 'ITEM_DEFINITIONS')?.initializer
  if (!array || !ts.isArrayLiteralExpression(array) || !array.elements.length) {
    throw new Error('未找到 ITEM_DEFINITIONS 数组字面量')
  }
  const items = array.elements.map(element => {
    if (!ts.isObjectLiteralExpression(element)) throw new Error('物品定义必须为对象字面量')
    const properties = new Map(element.properties.filter(ts.isPropertyAssignment)
      .map(property => [property.name.text, property.initializer]))
    const stringProperty = name => {
      const value = properties.get(name)
      if (!value || !ts.isStringLiteralLike(value) || !/^[\w-]+$/.test(value.text)) {
        throw new Error(`物品 ${name} 必须为安全的字符串字面量`)
      }
      return value.text
    }
    const tagsNode = properties.get('tags')
    if (!tagsNode || !ts.isArrayLiteralExpression(tagsNode)) throw new Error('物品 tags 必须为数组字面量')
    const tags = tagsNode.elements.filter(ts.isStringLiteralLike).map(node => node.text)
    const taggedId = prefix => {
      const matches = tags.filter(tag => tag.startsWith(prefix))
      if (matches.length > 1) throw new Error(`物品存在重复 ${prefix} tag`)
      return matches[0]?.slice(prefix.length)
    }
    const item = { id: stringProperty('id'), iconId: stringProperty('iconId'),
      containerId: taggedId('container:'), contentId: taggedId('container-item:') }
    if (!!item.containerId !== !!item.contentId) throw new Error(`容器 tags 不完整：${item.id}`)
    return item
  })
  if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('存在重复物品 ID')
  const byId = new Map(items.map(item => [item.id, item]))
  for (const item of items.filter(item => item.containerId)) {
    for (const id of [item.containerId, item.contentId]) {
      if (!byId.has(id) || byId.get(id).containerId) throw new Error(`合成图标依赖必须为原始物品：${item.id} → ${id}`)
    }
  }
  return items
}

export async function readItemIconDefinitions(registryFile) {
  return parseItemIconDefinitions(await readFile(registryFile, 'utf8'))
}

/** 原件小于目标时拒绝放大；260px 等原件只缩小，不裁切图案。 */
export async function encodeItemIcon(input) {
  const metadata = await sharp(input).metadata()
  if (metadata.width !== metadata.height || metadata.width < ITEM_ICON_SIZE) {
    throw new Error(`物品原图必须为至少 ${ITEM_ICON_SIZE}px 的正方形，收到 ${metadata.width}×${metadata.height}`)
  }
  return sharp(input).resize(ITEM_ICON_SIZE, ITEM_ICON_SIZE)
    .webp({ lossless: true }).toBuffer()
}

/** 内容物占容器画布的 50%；PNG 中间产物和最终 WebP 均无损。 */
export async function composeItemIcon(container, content) {
  for (const input of [container, content]) {
    const metadata = await sharp(input).metadata()
    if (metadata.width !== ITEM_ICON_SIZE || metadata.height !== ITEM_ICON_SIZE) {
      throw new Error(`合成输入必须为 ${ITEM_ICON_SIZE}×${ITEM_ICON_SIZE}`)
    }
  }
  const overlaySize = ITEM_ICON_SIZE / 2
  const overlay = await sharp(content).resize(overlaySize, overlaySize).png().toBuffer()
  return sharp(container).composite([{ input: overlay, left: overlaySize / 2, top: overlaySize / 2 }])
    .webp({ lossless: true }).toBuffer()
}

/** 读取实际 RIFF chunk，避免把文件扩展名或压缩数据中的巧合文本当成无损证明。 */
export function isLosslessWebp(bytes) {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') return false
  let lossless = false
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const type = bytes.toString('ascii', offset, offset + 4)
    const size = bytes.readUInt32LE(offset + 4)
    if (offset + 8 + size > bytes.length || type === 'VP8 ' || type === 'ANIM') return false
    if (type === 'VP8L') lossless = true
    offset += 8 + size + (size % 2)
  }
  return lossless
}

/** 透明像素的隐藏 RGB 不参与视觉对账；所有可见 RGB 与 alpha 必须逐字节一致。 */
export async function verifyItemIcon(bytes, expected) {
  if (!isLosslessWebp(bytes)) throw new Error('物品图标必须使用无损 WebP')
  const actual = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (actual.info.width !== ITEM_ICON_SIZE || actual.info.height !== ITEM_ICON_SIZE) {
    throw new Error('物品图标尺寸必须为 256×256')
  }
  if (expected) {
    const reference = await sharp(expected).ensureAlpha().raw().toBuffer()
    if (reference.length !== actual.data.length) throw new Error('图标对账尺寸不同')
    for (let offset = 0; offset < reference.length; offset += 4) {
      if (reference[offset + 3] !== actual.data[offset + 3]
        || (reference[offset + 3] !== 0 && [0, 1, 2].some(channel => reference[offset + channel] !== actual.data[offset + channel]))) {
        throw new Error(`图标像素对账失败：${offset / 4}`)
      }
    }
  }
}
