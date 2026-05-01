// registry 是全局可用的纯静态对象，在程序生命周期中，他的内容永远不会更改。

import { RegistryContract } from "@/domain/contract/registry-contracts"

import { BASE_DEFINITIONS } from "./base-definition"
import { ENTITY_DEFINITIONS } from "./entity-definition"
import { ITEM_DEFINITIONS } from "./item-definition"
import { RECIPE_DEFINITIONS } from "./recipe-definition"

export const createRegistryContract = (): RegistryContract => {
    return {
        queries: {},
        baseDefinitions: [...BASE_DEFINITIONS],
        entityDefinitions: [...ENTITY_DEFINITIONS],
        itemDefinitions: [...ITEM_DEFINITIONS],
        recipeDefinitions: [...RECIPE_DEFINITIONS],
    }
}