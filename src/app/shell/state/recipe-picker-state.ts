import { makeAutoObservable } from "mobx";

import type { DialogStateReadWrite } from "@/app/state/state-impl";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";

export type RecipePickerRequest =
  | {
    title?: string;
    initialQuery?: string;
    recipes: readonly RecipeDefinition[];
    entities?: never;
  }
  | {
    title?: string;
    initialQuery?: string;
    entities: readonly EntityDefinition[];
    recipes?: never;
  }
  | {
    title?: string;
    initialQuery?: string;
    recipes?: undefined;
    entities?: undefined;
  };

export type RecipePickerSource =
  | { kind: "recipes"; recipes: RecipeDefinition[] }
  | { kind: "entities"; entityIds: string[] };

function createDefaultDialogState(): DialogStateReadWrite {
  return {
    visible: false,
    maximized: false,
    offsetX: 0,
    offsetY: 0,
    width: null,
    height: null,
    activeTab: null,
  };
}

function dedupeRecipes(recipes: readonly RecipeDefinition[]): RecipeDefinition[] {
  const seen = new Set<string>();
  const deduped: RecipeDefinition[] = [];

  for (const recipe of recipes) {
    if (seen.has(recipe.id)) {
      continue;
    }

    seen.add(recipe.id);
    deduped.push(recipe);
  }

  return deduped;
}

function dedupeEntityIds(entities: readonly EntityDefinition[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const entity of entities) {
    if (seen.has(entity.id)) {
      continue;
    }

    seen.add(entity.id);
    deduped.push(entity.id);
  }

  return deduped;
}

export class WorkbenchRecipePickerController {
  dialogState: DialogStateReadWrite = createDefaultDialogState();
  title: string | null = null;
  query = "";
  source: RecipePickerSource | null = null;

  _resolver: ((recipeId: string | null) => void) | null = null;

  public constructor() {
    makeAutoObservable(this, {
      _resolver: false,
    }, { autoBind: true });
  }

  public setQuery(query: string) {
    this.query = query;
  }

  public setOffset(offsetX: number, offsetY: number) {
    if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) {
      return;
    }

    this.dialogState.offsetX = Math.round(offsetX);
    this.dialogState.offsetY = Math.round(offsetY);
  }

  public setSize(width: number | null, height: number | null) {
    if (width !== null && (!Number.isFinite(width) || width <= 0)) {
      return;
    }

    if (height !== null && (!Number.isFinite(height) || height <= 0)) {
      return;
    }

    this.dialogState.width = width === null ? null : Math.round(width);
    this.dialogState.height = height === null ? null : Math.round(height);
  }

  public toggleMaximized() {
    this.dialogState.maximized = !this.dialogState.maximized;
  }

  public pickRecipe(request: RecipePickerRequest = {}): Promise<string | null> {
    this.finish(null);

    this.title = request.title ?? null;
    this.query = request.initialQuery ?? "";
    this.source = normalizeRecipePickerSource(request);
    this.dialogState.visible = true;

    return new Promise((resolve) => {
      this._resolver = resolve;
    });
  }

  public selectRecipe(recipeId: string) {
    this.finish(recipeId);
  }

  public cancel() {
    this.finish(null);
  }

  public dispose() {
    this.finish(null);
  }

  private finish(recipeId: string | null) {
    const resolver = this._resolver;
    this._resolver = null;
    this.dialogState.visible = false;
    this.title = null;
    this.source = null;

    resolver?.(recipeId);
  }
}

function normalizeRecipePickerSource(request: RecipePickerRequest): RecipePickerSource | null {
  if (request.recipes !== undefined) {
    return {
      kind: "recipes",
      recipes: dedupeRecipes(request.recipes),
    };
  }

  if (request.entities !== undefined) {
    return {
      kind: "entities",
      entityIds: dedupeEntityIds(request.entities),
    };
  }

  return null;
}
