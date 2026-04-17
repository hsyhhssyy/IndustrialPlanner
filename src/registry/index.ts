// registry 是全局可用的纯静态对象，在程序生命周期中，他的内容永远不会更改。

import { RegistryContract } from "@/domain/contract/registry-contracts"


export const createRegistryContract = () : RegistryContract => {
    return {
    queries: {},
    entityDefinitions: [],
    itemDefinitions: [],
    recipeDefinitions: []
}}