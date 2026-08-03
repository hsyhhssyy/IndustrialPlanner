// registry 是全局可用的纯静态对象，在程序生命周期中，他的内容永远不会更改。

import { RegistryContract } from "@/domain/registry/registry-contract"

import { BASE_DEFINITIONS } from "./base-definition"
import { ENTITY_DEFINITIONS } from "./entity-definition"
import { ENTITY_VARIANT_DEFINITIONS } from "./entity-variant-definition"
import { ITEM_DEFINITIONS } from "./item-definition"
import { createRegistryQuery } from "./registry-query"
import { RECIPE_DEFINITIONS } from "./recipe-definition"

export const createRegistryContract = (): RegistryContract => {
    const baseDefinitions = [...BASE_DEFINITIONS]
    const entityDefinitions = [...ENTITY_DEFINITIONS]
    const entityVariantDefinitions = { ...ENTITY_VARIANT_DEFINITIONS }
    const itemDefinitions = [...ITEM_DEFINITIONS]
    const recipeDefinitions = RECIPE_DEFINITIONS.map((recipe) => ({
        ...recipe,
        primaryOutputs: recipe.outputs.length > 0 ? [recipe.outputs[0]!.itemId] : [],
    }))

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
