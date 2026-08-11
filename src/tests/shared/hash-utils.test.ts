// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  createSha256CanonicalHash,
  createSha256Hash,
  stringifyCanonicalJson,
} from "@/shared/storage/hash-utils";

describe("hash-utils", () => {
  it("serializes canonical JSON with stable object key order", () => {
    expect(stringifyCanonicalJson({ z: 1, a: 2 })).toBe('{"a":2,"z":1}');
  });

  it("hashes the exact bytes supplied by the caller", async () => {
    const bytes = new TextEncoder().encode('{"z":1,"a":2}');

    await expect(createSha256Hash(bytes)).resolves.toBe(
      "sha256:c5c2b1fdd0d4a83cda3ff79c9c74f2c72e2a92920afda20bcafc90c1a72f86a9",
    );
  });

  it("canonical JSON hash is independent of object insertion order", async () => {
    await expect(createSha256CanonicalHash({ z: 1, a: 2 })).resolves.toBe(
      await createSha256CanonicalHash({ a: 2, z: 1 }),
    );
  });
});
