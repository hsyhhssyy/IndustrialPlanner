import type { ItemDefinition } from "@/domain/registry/types/item-definition";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";

export interface ActivityDefinition {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly startTime?: number;
  readonly endTime?: number;
}

export const ACTIVITY_TAG_PREFIX = "activity:";
export const ACTIVITY_LIMITED_FORMULA_1_ID = "activity-limited-formula-1";
export const ACTIVITY_LIMITED_FORMULA_1_TAG = `${ACTIVITY_TAG_PREFIX}${ACTIVITY_LIMITED_FORMULA_1_ID}`;
export const ACTIVITY_LIMITED_FORMULA_2_ID = "activity-limited-formula-2";
export const ACTIVITY_LIMITED_FORMULA_2_TAG = `${ACTIVITY_TAG_PREFIX}${ACTIVITY_LIMITED_FORMULA_2_ID}`;

export const ACTIVITY_DEFINITIONS: readonly ActivityDefinition[] = [
  {
    id: ACTIVITY_LIMITED_FORMULA_1_ID,
    name: "集成援助·掌中救星",
    icon: "/item-icons/item_activity_xiranite_enr_hulu.webp",
    startTime: Date.parse("2026-04-28T00:00:00+08:00"),
    endTime: Date.parse("2026-05-19T00:00:00+08:00"),
  },
  {
    id: ACTIVITY_LIMITED_FORMULA_2_ID,
    name: "集成援助·泡泡出击",
    icon: "/item-icons/missing-item-icon.webp",
    startTime: Date.parse("2026-09-16T12:00:00+08:00"),
    endTime: Date.parse("2026-09-30T16:00:00+08:00"),
  },
];

export function isActivityOngoing(
  activity: ActivityDefinition,
  now: number = Date.now(),
): boolean {
  if (activity.startTime !== undefined && now < activity.startTime) {
    return false;
  }

  if (activity.endTime !== undefined && now >= activity.endTime) {
    return false;
  }

  return true;
}

export function normalizeSelectedActivityIds(
  selectedActivityIds: readonly string[] | undefined,
  activities: readonly ActivityDefinition[] = ACTIVITY_DEFINITIONS,
): string[] {
  const knownActivityIds = new Set(activities.map((activity) => activity.id));
  const normalized: string[] = [];

  for (const id of selectedActivityIds ?? []) {
    if (!knownActivityIds.has(id) || normalized.includes(id)) {
      continue;
    }

    normalized.push(id);
  }

  return normalized;
}

export function resolveEffectiveActivityIds(options: {
  readonly selectedActivityIds?: readonly string[];
  readonly activities?: readonly ActivityDefinition[];
  readonly now?: number;
} = {}): string[] {
  const activities = options.activities ?? ACTIVITY_DEFINITIONS;
  const effective = new Set(normalizeSelectedActivityIds(options.selectedActivityIds, activities));
  const now = options.now ?? Date.now();

  for (const activity of activities) {
    if (isActivityOngoing(activity, now)) {
      effective.add(activity.id);
    }
  }

  return activities
    .map((activity) => activity.id)
    .filter((activityId) => effective.has(activityId));
}

export function resolveActivityIdsFromTags(tags: readonly string[]): string[] {
  const ids: string[] = [];

  for (const tag of tags) {
    if (!tag.startsWith(ACTIVITY_TAG_PREFIX)) {
      continue;
    }

    const id = tag.slice(ACTIVITY_TAG_PREFIX.length);
    if (id.length > 0 && !ids.includes(id)) {
      ids.push(id);
    }
  }

  return ids;
}

export function hasActivityTags(tags: readonly string[]): boolean {
  return resolveActivityIdsFromTags(tags).length > 0;
}

export function areActivityTagsEffective(
  tags: readonly string[],
  effectiveActivityIds: readonly string[],
): boolean {
  const activityIds = resolveActivityIdsFromTags(tags);
  if (activityIds.length === 0) {
    return true;
  }

  const effectiveActivityIdSet = new Set(effectiveActivityIds);
  return activityIds.some((activityId) => effectiveActivityIdSet.has(activityId));
}

export function isItemAvailableByActivity(
  item: Pick<ItemDefinition, "tags">,
  effectiveActivityIds: readonly string[],
): boolean {
  return areActivityTagsEffective(item.tags, effectiveActivityIds);
}

export function isRecipeAvailableByActivity(
  recipe: Pick<RecipeDefinition, "tags">,
  effectiveActivityIds: readonly string[],
): boolean {
  return areActivityTagsEffective(recipe.tags, effectiveActivityIds);
}

export function resolveActivityDefinitionsByIds(
  activityIds: readonly string[],
  activities: readonly ActivityDefinition[] = ACTIVITY_DEFINITIONS,
): ActivityDefinition[] {
  const requestedIds = new Set(activityIds);
  return activities.filter((activity) => requestedIds.has(activity.id));
}
