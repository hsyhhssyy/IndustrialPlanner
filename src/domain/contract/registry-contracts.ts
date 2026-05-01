import { RegistryQuery } from "../query/registry-query";
import { BaseDefinition } from "../types/registry/base-definition";
import { EntityDefinition } from "../types/registry/entity-definition";
import { ItemDefinition } from "../types/registry/item-definition";
import { RecipeDefinition } from "../types/registry/recipe-definition";

export interface RegistryContract {
  queries: RegistryQuery;
  baseDefinitions: BaseDefinition[];
  entityDefinitions: EntityDefinition[];
  itemDefinitions: ItemDefinition[];
  recipeDefinitions: RecipeDefinition[];
}