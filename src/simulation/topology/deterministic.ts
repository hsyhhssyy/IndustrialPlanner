export function stableStringify(value: unknown): string {
  return JSON.stringify(toStableJsonValue(value));
}

export function hashStable(value: unknown): string {
  const text = stableStringify(value);
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function toStableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => toStableJsonValue(entry));
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  const record = value as Record<string, unknown>;
  const nextRecord: Record<string, unknown> = {};

  for (const key of Object.keys(record).sort()) {
    nextRecord[key] = toStableJsonValue(record[key]);
  }

  return nextRecord;
}
