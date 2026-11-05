import { afterEach, describe, expect, it, vi } from "vitest";

import { loadChangelogIndexEntries } from "@/app/shell/dialogs/changelog-data";

function stubIndex(date: unknown): void {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([{
    file: "1.6.1.md",
    title: "版本更新 v1.6.1",
    version: "1.6.1",
    kind: "main",
    date,
  }]), { status: 200 })));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("changelog release dates", () => {
  it.each(["2026-10-28", "2024-02-29"])("preserves the calendar date %s without timezone conversion", async (date) => {
    stubIndex(date);

    const entries = await loadChangelogIndexEntries();

    expect(entries[0]?.date).toBe(date);
  });

  it.each([undefined, null])("allows an entry without a known tag date (%s)", async (date) => {
    stubIndex(date);

    const entries = await loadChangelogIndexEntries();

    expect(entries[0]?.date).toBeNull();
  });

  it.each(["2026-02-29", "2026-04-31", "2026-13-01", "2026-10-28T15:34:15Z", "2026-1-2", 20261028])(
    "rejects invalid calendar dates and timestamps (%s)",
    async (date) => {
      stubIndex(date);

      await expect(loadChangelogIndexEntries()).rejects.toThrow("更新日志索引格式无效");
    },
  );
});
