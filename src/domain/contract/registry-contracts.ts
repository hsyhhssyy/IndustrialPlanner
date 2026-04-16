import { RegistryQuery } from "../query/registry-query";
import { EntityDefinition } from "../types/registery/entity-definition";
import { ItemDefinition } from "../types/registery/item-definition";
import { RecipeDefinition } from "../types/registery/recipe-definition";

export interface RegistryContract {
  queries: RegistryQuery;
  entityDefinitions: EntityDefinition[];
  itemDefinitions: ItemDefinition[];
  recipeDefinitions: RecipeDefinition[];
}