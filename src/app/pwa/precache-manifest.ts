export interface PrecacheEntry {
  readonly bytes?: number;
  readonly integrity?: string;
  readonly revision: string | null;
  readonly sha256?: string;
  readonly size?: number;
  readonly url: string;
}

export function normalizePrecacheEntries(entries: readonly PrecacheEntry[]): readonly PrecacheEntry[] {
  const entryByUrl = new Map<string, PrecacheEntry>();

  for (const entry of entries) {
    const existingEntry = entryByUrl.get(entry.url);

    if (existingEntry === undefined || shouldPreferPrecacheEntry(entry, existingEntry)) {
      entryByUrl.set(entry.url, entry);
    }
  }

  return [...entryByUrl.values()];
}

export function calculateTotalBytes(entries: readonly PrecacheEntry[]): number {
  return entries.reduce((total, entry) => total + resolvePrecacheEntryByteSize(entry), 0);
}

export function resolvePrecacheEntryByteSize(entry: PrecacheEntry): number {
  if (typeof entry.bytes === "number" && Number.isFinite(entry.bytes) && entry.bytes >= 0) {
    return entry.bytes;
  }

  if (typeof entry.size === "number" && Number.isFinite(entry.size) && entry.size >= 0) {
    return entry.size;
  }

  return 0;
}

export function hashPrecacheEntries(entries: readonly PrecacheEntry[]): string {
  const signature = entries
    .map((entry) =>
      [
        entry.url,
        entry.revision ?? "none",
        entry.sha256 ?? "none",
        resolvePrecacheEntryByteSize(entry),
      ].join(":")
    )
    .sort()
    .join("|");
  let hash = 2166136261;

  for (let index = 0; index < signature.length; index += 1) {
    hash ^= signature.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function shouldPreferPrecacheEntry(candidate: PrecacheEntry, current: PrecacheEntry): boolean {
  const candidateScore = scorePrecacheEntry(candidate);
  const currentScore = scorePrecacheEntry(current);

  if (candidateScore !== currentScore) {
    return candidateScore > currentScore;
  }

  return candidate.revision !== null && current.revision === null;
}

function scorePrecacheEntry(entry: PrecacheEntry): number {
  let score = 0;

  if (typeof entry.sha256 === "string" && entry.sha256.length > 0) {
    score += 4;
  }

  if (resolvePrecacheEntryByteSize(entry) > 0) {
    score += 2;
  }

  if (entry.revision !== null) {
    score += 1;
  }

  if (typeof entry.integrity === "string" && entry.integrity.length > 0) {
    score += 1;
  }

  return score;
}
