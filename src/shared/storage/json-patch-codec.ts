import jsonPatch, { type Operation } from "fast-json-patch";

export type JsonPatchOperation = Operation;

export function generateJsonPatch<TValue>(
  from: TValue,
  to: TValue,
): JsonPatchOperation[] {
  return jsonPatch.compare(
    cloneJsonValue(from) as object | unknown[],
    cloneJsonValue(to) as object | unknown[],
  );
}

export function applyJsonPatch<TValue>(
  target: TValue,
  patch: readonly JsonPatchOperation[],
): TValue {
  const result = jsonPatch.applyPatch(
    cloneJsonValue(target) as object | unknown[],
    [...patch],
    true,
    false,
    true,
  );

  return result.newDocument as TValue;
}

function cloneJsonValue<TValue>(value: TValue): TValue {
  return JSON.parse(JSON.stringify(value)) as TValue;
}