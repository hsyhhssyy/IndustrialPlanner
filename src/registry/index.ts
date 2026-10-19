import { validateEntityRanges } from "./entity-range-validation"
// registry 是全局可用的纯静态对象，在程序生命周期中，他的内容永远不会更改。

import { RegistryContract } from "@/domain/registry/registry-contract"
import type { ItemDefinition } from "@/domain/registry/types/item-definition"
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition"
import { WIKI_DEFAULT_CRAFT_RECIPE_TAG } from "@/shared/registry/recipe-visibility"
import { validateEntityPlacementWhitelists } from "@/shared/entity-placement-whitelist"

import { BASE_DEFINITIONS } from "./base-definition"
import { ENTITY_DEFINITIONS } from "./entity-definition"
import { ENTITY_VARIANT_DEFINITIONS } from "./entity-variant-definition"
import { ITEM_DEFINITIONS } from "./item-definition"
import { createRegistryQuery } from "./registry-query"
import { createCropPlanningRecipes } from "./crop-planning-definitions"
import { RECIPE_DEFINITIONS } from "./recipe-definition"
import { WIKI_DEFAULT_CRAFT_DEFINITIONS } from "./wiki-default-craft-definition"

const FLUID_COLOR_TAG_PATTERN = /^(?:gas_color|fluid_color|liquid_color):/
const HEX_COLOR_PATTERN = /^#[\da-f]{6}$/
const WIKI_DEFAULT_RECIPE_IDS = new Set(
    WIKI_DEFAULT_CRAFT_DEFINITIONS.map((definition) => definition.recipeId),
)

/** Registry 启动即拒绝缺层、错相态和已退役颜色 tag，避免渲染期掩盖坏数据。 */
function validateItemFluidColors(itemDefinitions: readonly ItemDefinition[]): void {
    for (const item of itemDefinitions) {
        const liquid = item.tags.includes("liquid")
        const gas = item.tags.includes("gas")
        const retiredTag = item.tags.find((tag) => FLUID_COLOR_TAG_PATTERN.test(tag))
        if (retiredTag) throw new Error(`Retired fluid color tag on ${item.id}: ${retiredTag}`)
        if (liquid && gas) throw new Error(`Item cannot be both liquid and gas: ${item.id}`)
        if (!liquid && !gas) {
            if (item.fluidColors) throw new Error(`Non-fluid item declares fluidColors: ${item.id}`)
            continue
        }
        if (!item.fluidColors) throw new Error(`Fluid item is missing fluidColors: ${item.id}`)
        const requiredRoles = liquid
            ? (["body", "skin", "skin2", "splash"] as const)
            : (["body", "skin"] as const)
        for (const role of requiredRoles) {
            const color = item.fluidColors[role]
            if (!color || !HEX_COLOR_PATTERN.test(color)) {
                throw new Error(`Invalid ${role} fluid color on ${item.id}: ${String(color)}`)
            }
        }
        if (gas && (item.fluidColors.skin2 !== undefined || item.fluidColors.splash !== undefined)) {
            throw new Error(`Gas item declares unsupported liquid color layers: ${item.id}`)
        }
    }
}

function validateWikiDefaultCraftDefinitions(
    recipeDefinitions: readonly RecipeDefinition[],
): void {
    const recipeById = new Map(recipeDefinitions.map((recipe) => [recipe.id, recipe]))
    const seenItemIds = new Set<string>()
    for (const definition of WIKI_DEFAULT_CRAFT_DEFINITIONS) {
        if (seenItemIds.has(definition.itemId)) {
            throw new Error(`Duplicate WikiDefaultCraft item: ${definition.itemId}`)
        }
        seenItemIds.add(definition.itemId)
        const recipe = recipeById.get(definition.recipeId)
        if (recipe === undefined) {
            throw new Error(`Missing WikiDefaultCraft recipe: ${definition.recipeId}`)
        }
        if (!recipe.outputs.some((output) => output.itemId === definition.itemId)) {
            throw new Error(`WikiDefaultCraft recipe ${definition.recipeId} does not output ${definition.itemId}`)
        }
    }
}

export const createRegistryContract = (): RegistryContract => {
    const baseDefinitions = [...BASE_DEFINITIONS]
    const entityDefinitions = [...ENTITY_DEFINITIONS]
    validateEntityPlacementWhitelists(entityDefinitions, baseDefinitions)
    const entityVariantDefinitions = { ...ENTITY_VARIANT_DEFINITIONS }
    const itemDefinitions = [...ITEM_DEFINITIONS]
    validateItemFluidColors(itemDefinitions)
    const itemIds = new Set(itemDefinitions.map((item) => item.id))
    const recipeDefinitions: RecipeDefinition[] = RECIPE_DEFINITIONS.map((recipe) => ({
        ...recipe,
        tags: WIKI_DEFAULT_RECIPE_IDS.has(recipe.id)
            ? [...recipe.tags, WIKI_DEFAULT_CRAFT_RECIPE_TAG]
            : [...recipe.tags],
        // AI-REMOVED 2026-10-04:
        // Reason: 无条件使用首个产物会把运输占位符当成可显示物品。
        // Trigger: 暗管出口运输时显示红色图标。
        // Evidence: 两种出口配方输出 same-as-input，Registry 中没有对应物品和图标。
        // Replacement: 下方仅对注册物品派生主要产物的规则。
        // Risk: Low - 真实首个产物的图标和运输配方保持原有语义。
        // Human Review: Required
        //
        // Original code:
        // primaryOutputs: recipe.outputs.length > 0 ? [recipe.outputs[0]!.itemId] : [],
        primaryOutputs: recipe.outputs.length > 0 && itemIds.has(recipe.outputs[0]!.itemId)
            ? [recipe.outputs[0]!.itemId]
            : [],
    }))
    recipeDefinitions.push(...createCropPlanningRecipes(entityDefinitions, recipeDefinitions))
    validateWikiDefaultCraftDefinitions(recipeDefinitions)
    validateEntityRanges(entityDefinitions, recipeDefinitions)

    return {
        queries: createRegistryQuery({
            entityDefinitions,
            itemDefinitions,
            recipeDefinitions,
        }),
        baseDefinitions,
        entityDefinitions,
        entityVariantDefinitions,
        itemDefinitions,
        recipeDefinitions,
    }
}

export { WIKI_DEFAULT_CRAFT_DEFINITIONS } from "./wiki-default-craft-definition"
export type { WikiDefaultCraftDefinition } from "./wiki-default-craft-definition"
