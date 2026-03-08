export type SuperRecipeControlMode = 'user-controllable' | 'forced-off'

export const SUPER_RECIPE_CONTROL_MODE: SuperRecipeControlMode = 'user-controllable'

export function normalizeSuperRecipeEnabledPreference(value: boolean): boolean {
  if (SUPER_RECIPE_CONTROL_MODE === 'forced-off') return false
  return Boolean(value)
}
