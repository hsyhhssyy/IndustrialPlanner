import { RegistryQuery } from "../query/registry-query";
import { EntityDefinition } from "../types/registry/entity-definition";
import { ItemDefinition } from "../types/registry/item-definition";
import { RecipeDefinition } from "../types/registry/recipe-definition";

export interface RegistryContract {
  queries: RegistryQuery;
  entityDefinitions: EntityDefinition[];
  itemDefinitions: ItemDefinition[];
  recipeDefinitions: RecipeDefinition[];
}