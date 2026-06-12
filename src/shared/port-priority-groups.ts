export const PORT_PRIORITY_GROUP_MIN = 1;
export const PORT_PRIORITY_GROUP_MAX = 9;
export const DEFAULT_PORT_PRIORITY_GROUP = 5;

export const CUSTOM_PORT_PRIORITY_GROUPS_CONFIG_KEY = "customPortPriorityGroups";
export const PORT_PRIORITY_GROUP_OVERRIDES_CONFIG_KEY = "portPriorityGroups";

export function resolvePortPriorityGroupOverrideKey(
  portGroupId: string,
  portId: string,
): string {
  return `${portGroupId}:${portId}`;
}

export function isCustomPortPriorityGroupsEnabled(
  config: Readonly<Record<string, unknown>>,
): boolean {
  return config[CUSTOM_PORT_PRIORITY_GROUPS_CONFIG_KEY] === true;
}

export function normalizePortPriorityGroup(value: unknown): number {
  if (
    typeof value === "number"
    && Number.isInteger(value)
    && value >= PORT_PRIORITY_GROUP_MIN
    && value <= PORT_PRIORITY_GROUP_MAX
  ) {
    return value;
  }

  return DEFAULT_PORT_PRIORITY_GROUP;
}

export function readPortPriorityGroupOverrides(
  config: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const raw = config[PORT_PRIORITY_GROUP_OVERRIDES_CONFIG_KEY];

  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  return raw as Readonly<Record<string, unknown>>;
}
