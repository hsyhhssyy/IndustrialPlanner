import { RegistryQuery } from "./registry-query";
import { BaseDefinition } from "./types/base-definition";
import { EntityDefinition } from "./types/entity-definition";
import { ItemDefinition } from "./types/item-definition";
import { RecipeDefinition } from "./types/recipe-definition";
import { EntityVariantDefinition } from "./types/entity-variant-definition";

export interface RegistryContract {
  queries: RegistryQuery;
  baseDefinitions: BaseDefinition[];
  entityDefinitions: EntityDefinition[];
  entityVariantDefinitions: Readonly<Record<string, EntityVariantDefinition>>;
  itemDefinitions: ItemDefinition[];
  recipeDefinitions: RecipeDefinition[];
}
